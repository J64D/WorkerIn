import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '0.0.0.0';
const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
const mediaBucket = process.env.SUPABASE_MEDIA_BUCKET || 'workerin-media';
const appBaseUrl = String(process.env.APP_BASE_URL || '').replace(/\/$/, '');
const authRedirectUrl = process.env.AUTH_REDIRECT_URL || 'http://localhost:4173';
const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN || '';
const mpWebhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET || '';
const mpApi = 'https://api.mercadopago.com';

if (!supabaseUrl || !publishableKey || !secretKey) {
  throw new Error('Configure SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY e SUPABASE_SECRET_KEY para iniciar o modo Supabase.');
}

const authClient = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const app = express();
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors({ origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:4173').split(',').map(value => value.trim()), credentials: true }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use(express.json({ limit: '1mb' }));
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const online = new Map();
const liveRooms = new Map();
const pendingUploads = new Map();

const jsonError = (status, message) => Object.assign(new Error(message), { status });
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const escapeFilter = value => String(value).replace(/[(),]/g, '');
const isEmail = value => /^\S+@\S+\.\S+$/.test(String(value || '').trim());
const safeArray = value => Array.isArray(value) ? value : [];
const mapProfile = row => row ? ({
  id: row.id, profileType: row.profile_type, name: row.name, gender: row.gender, age: row.age,
  role: row.role, area: row.area, city: row.city, distance: Number(row.distance || 0),
  rate: Number(row.rate || 0), work: row.work_modes || [], skills: row.skills || [],
  bio: row.bio || '', photo: row.photos?.[0] || '', photos: row.photos || [],
  introMedia: row.intro_media || null, available: row.available, verified: row.verified,
  portfolio: row.portfolio || [],
}) : null;
function profileInsert(body, id) {
  const company = body.profileType === 'company';
  return {
    id, profile_type: body.profileType, name: String(body.name || '').trim(),
    gender: company ? null : (body.gender || null), age: company ? null : Number(body.age),
    role: String(body.role || '').trim(), area: String(body.area || '').trim(), city: String(body.city || '').trim(),
    lat: Number.isFinite(Number(body.lat)) ? Number(body.lat) : -23.5505,
    lon: Number.isFinite(Number(body.lon)) ? Number(body.lon) : -46.6333,
    rate: Number(body.rate), work_modes: safeArray(body.workModes), skills: safeArray(body.skills),
    bio: String(body.bio || '').slice(0, 1200), photos: safeArray(body.photos),
    intro_media: body.introMedia || null, available: true, verified: false, portfolio: [],
  };
}
function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function pairKey(first, second) { return [first, second].sort().join(':'); }
function pairIds(first, second) { return [first, second].sort(); }
function tokenFromRequest(req) { return req.get('authorization')?.replace(/^Bearer\s+/i, '') || ''; }
async function getProfile(id) {
  const { data, error } = await admin.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
async function getPro(profileId) {
  const { data, error } = await admin.from('subscriptions').select('status,current_period_end').eq('profile_id', profileId).in('status', ['authorized', 'active']).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return Boolean(data && (!data.current_period_end || Date.parse(data.current_period_end) > Date.now()));
}
async function authenticated(req, res, next) {
  const accessToken = tokenFromRequest(req);
  if (!accessToken) return res.status(401).json({ error: 'Autenticação necessária.' });
  try {
    const { data, error } = await authClient.auth.getUser(accessToken);
    if (error || !data.user) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    const profile = await getProfile(data.user.id);
    if (!profile) return res.status(404).json({ error: 'Perfil da conta não encontrado.' });
    req.auth = { user: data.user, profile, accessToken };
    next();
  } catch (error) { next(error); }
}
function serviceAuth(req, res, next) {
  if (!process.env.SERVICE_TOKEN || req.get('x-service-token') !== process.env.SERVICE_TOKEN) return res.status(401).json({ error: 'Serviço não autorizado.' });
  next();
}
async function rowsForProfiles(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await admin.from('profiles').select('*').in('id', unique);
  if (error) throw error;
  return new Map((data || []).map(row => [row.id, mapProfile(row)]));
}
async function findConversation(first, second) {
  const { data, error } = await admin.from('conversations').select('*').eq('pair_key', pairKey(first, second)).maybeSingle();
  if (error) throw error;
  return data;
}
async function createConversation(first, second, type = 'match', createdBy = null) {
  const [participant_a, participant_b] = pairIds(first, second);
  const { data, error } = await admin.from('conversations').upsert({ pair_key: pairKey(first, second), participant_a, participant_b, type, created_by: createdBy }, { onConflict: 'pair_key' }).select('*').single();
  if (error) throw error;
  return data;
}
async function openProSubscription(profileId) {
  const { data, error } = await admin.from('subscriptions').select('*').eq('profile_id', profileId).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}
function validMercadoPagoSignature(req) {
  if (!mpWebhookSecret) return false;
  const header = req.get('x-signature') || '';
  const fields = Object.fromEntries(header.split(',').map(part => part.trim().split(/=(.*)/s).slice(0, 2)));
  const requestId = req.get('x-request-id') || '';
  const dataId = String(req.query['data.id'] || req.body?.data?.id || '').toLowerCase();
  if (!fields.ts || !fields.v1 || !requestId || !dataId) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${fields.ts};`;
  const expected = crypto.createHmac('sha256', mpWebhookSecret).update(manifest).digest();
  let provided;
  try { provided = Buffer.from(fields.v1, 'hex'); } catch { return false; }
  return provided.length === expected.length && crypto.timingSafeEqual(expected, provided);
}

app.get('/api/health/live', (_req, res) => res.json({ status: 'ok', service: 'workerin-supabase' }));
app.get('/api/health/ready', asyncRoute(async (_req, res) => {
  const { error } = await admin.from('profiles').select('id', { head: true, count: 'exact' });
  if (error) return res.status(503).json({ status: 'degraded', database: false, error: error.message });
  res.json({ status: 'ready', database: 'supabase-postgres', auth: 'supabase', realtime: 'websocket' });
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const body = req.body || {};
  if (!isEmail(body.email) || typeof body.password !== 'string' || body.password.length < 10 || !['freelancer', 'company'].includes(body.profileType) || !String(body.name || '').trim() || !String(body.role || '').trim() || !String(body.area || '').trim() || !String(body.city || '').trim() || !Number.isFinite(Number(body.rate)) || Number(body.rate) < 0) return res.status(400).json({ error: 'Informe e-mail válido, senha de 10+ caracteres e os dados básicos do perfil.' });
  if (body.profileType === 'freelancer' && (!Number.isFinite(Number(body.age)) || Number(body.age) < 18)) return res.status(400).json({ error: 'O WorkerIN é destinado a pessoas maiores de 18 anos.' });
  const { data, error } = await authClient.auth.signUp({ email: String(body.email).trim().toLowerCase(), password: body.password, options: { emailRedirectTo: authRedirectUrl, data: { name: String(body.name).trim(), profile_type: body.profileType } } });
  if (error) return res.status(error.status === 422 || /already registered|already exists/i.test(error.message) ? 409 : 400).json({ error: /already registered|already exists/i.test(error.message) ? 'Este e-mail já possui cadastro.' : error.message });
  if (!data.user) return res.status(400).json({ error: 'Não foi possível criar a conta. Confira as configurações de e-mail do Supabase.' });
  const profile = profileInsert(body, data.user.id);
  const inserted = await admin.from('profiles').insert(profile).select('*').single();
  if (inserted.error) {
    await admin.auth.admin.deleteUser(data.user.id).catch(() => {});
    if (inserted.error.code === '23505') return res.status(409).json({ error: 'Este e-mail já possui cadastro.' });
    throw inserted.error;
  }
  res.status(201).json({ token: data.session?.access_token || null, refreshToken: data.session?.refresh_token || null, profile: mapProfile(inserted.data), requiresEmailConfirmation: !data.session, message: data.session ? 'Conta criada.' : 'Conta criada. Confirme seu e-mail antes de entrar.' });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  if (!isEmail(email) || typeof password !== 'string' || !password) return res.status(400).json({ error: 'Informe seu e-mail e senha.' });
  const { data, error } = await authClient.auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password });
  if (error || !data.session) return res.status(401).json({ error: 'E-mail ou senha inválidos. Se acabou de se cadastrar, confirme seu e-mail primeiro.' });
  const profile = await getProfile(data.user.id);
  if (!profile) return res.status(404).json({ error: 'Perfil não encontrado para esta conta.' });
  res.json({ token: data.session.access_token, refreshToken: data.session.refresh_token, profile: mapProfile(profile) });
}));
app.post('/api/auth/refresh', asyncRoute(async (req, res) => {
  const refreshToken = String(req.body?.refreshToken || '');
  if (!refreshToken) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  const { data, error } = await authClient.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  const profile = await getProfile(data.user.id);
  if (!profile) return res.status(404).json({ error: 'Perfil não encontrado para esta conta.' });
  res.json({ token: data.session.access_token, refreshToken: data.session.refresh_token, profile: mapProfile(profile) });
}));
app.post('/api/auth/ws-ticket', authenticated, (req, res) => res.json({ ticket: jwt.sign({ profileId: req.auth.profile.id, purpose: 'ws' }, jwtSecret, { expiresIn: '60s', issuer: 'workerin', audience: 'workerin-chat' }), expiresIn: 60 }));
app.post('/api/auth/live-ticket', authenticated, (req, res) => res.json({ ticket: jwt.sign({ profileId: req.auth.profile.id, purpose: 'live' }, jwtSecret, { expiresIn: '60s', issuer: 'workerin', audience: 'workerin-live' }), expiresIn: 60 }));

app.get('/api/profiles/discover', asyncRoute(async (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const radius = Math.min(500, Math.max(1, Number(req.query.radiusKm) || 50));
  let query = admin.from('profiles').select('*').limit(1000);
  if (req.query.type === 'company' || req.query.type === 'freelancer') query = query.eq('profile_type', req.query.type);
  if (req.query.gender) query = query.eq('gender', String(req.query.gender));
  if (req.query.area) query = query.eq('area', String(req.query.area));
  if (req.query.city) query = query.ilike('city', `%${escapeFilter(req.query.city)}%`);
  if (req.query.workMode) query = query.contains('work_modes', [String(req.query.workMode)]);
  if (req.query.maxRate) query = query.lte('rate', Number(req.query.maxRate));
  if (req.query.available === 'true') query = query.eq('available', true);
  if (req.headers.authorization) { try { const { data } = await authClient.auth.getUser(tokenFromRequest(req)); if (data.user) query = query.neq('id', data.user.id); } catch {} }
  const { data, error } = await query;
  if (error) throw error;
  const profiles = (data || []).map(row => ({ ...mapProfile(row), distance: hasGeo && Number.isFinite(row.lat) && Number.isFinite(row.lon) ? Math.round(haversineKm(lat, lon, row.lat, row.lon) * 10) / 10 : 0 }))
    .filter(profile => profile.distance <= radius).sort((a, b) => a.distance - b.distance).slice(0, 100);
  res.json({ profiles, count: profiles.length, radiusKm: radius, source: 'supabase-postgres' });
}));
app.get('/api/profiles/me', authenticated, (req, res) => res.json({ profile: mapProfile(req.auth.profile) }));
app.get('/api/profiles/:id', asyncRoute(async (req, res) => {
  const { data, error } = await admin.from('profiles').select('*').eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: 'Perfil não encontrado.' });
  const accessToken = tokenFromRequest(req);
  if (accessToken) {
    const { data: userData } = await authClient.auth.getUser(accessToken);
    if (userData.user && userData.user.id !== data.id) {
      const after = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const prior = await admin.from('visits').select('id').eq('viewer_profile_id', userData.user.id).eq('target_profile_id', data.id).gte('visited_at', after).limit(1);
      if (!prior.error && !prior.data?.length) await admin.from('visits').insert({ viewer_profile_id: userData.user.id, target_profile_id: data.id });
    }
  }
  res.json({ profile: mapProfile(data) });
}));
app.patch('/api/profiles/me', authenticated, asyncRoute(async (req, res) => {
  const body = req.body || {}, row = {};
  const fields = { name: 'name', gender: 'gender', age: 'age', role: 'role', area: 'area', city: 'city', lat: 'lat', lon: 'lon', rate: 'rate', workModes: 'work_modes', work: 'work_modes', skills: 'skills', bio: 'bio', photos: 'photos', introMedia: 'intro_media', available: 'available', portfolio: 'portfolio' };
  for (const [input, column] of Object.entries(fields)) if (Object.hasOwn(body, input)) row[column] = body[input];
  row.updated_at = new Date().toISOString();
  if (req.auth.profile.profile_type === 'company') { row.gender = null; row.age = null; }
  const { data, error } = await admin.from('profiles').update(row).eq('id', req.auth.profile.id).select('*').single();
  if (error) throw error;
  res.json({ profile: mapProfile(data) });
}));
app.get('/api/account/plan', authenticated, asyncRoute(async (req, res) => {
  const pro = await getPro(req.auth.profile.id);
  res.json({ plan: pro ? 'pro' : 'free', status: pro ? 'active' : 'inactive', priceBRL: 7, interval: 'month', features: { profileVisitors: pro, incomingLikes: pro, directMessages: pro } });
}));
app.get('/api/account/activity', authenticated, asyncRoute(async (req, res) => {
  if (!await getPro(req.auth.profile.id)) return res.status(403).json({ error: 'O plano Pro é necessário para ver visitantes e curtidas recebidas.' });
  const profileId = req.auth.profile.id;
  const [likesResult, visitsResult] = await Promise.all([
    admin.from('interests').select('from_profile_id,created_at').eq('to_profile_id', profileId).eq('decision', 'like').order('created_at', { ascending: false }).limit(100),
    admin.from('visits').select('viewer_profile_id,visited_at').eq('target_profile_id', profileId).order('visited_at', { ascending: false }).limit(100),
  ]);
  if (likesResult.error) throw likesResult.error;
  if (visitsResult.error) throw visitsResult.error;
  const profiles = await rowsForProfiles([...(likesResult.data || []).map(row => row.from_profile_id), ...(visitsResult.data || []).map(row => row.viewer_profile_id)]);
  const likes = (likesResult.data || []).map(row => ({ createdAt: row.created_at, profile: profiles.get(row.from_profile_id) })).filter(row => row.profile);
  const visits = (visitsResult.data || []).map(row => ({ visitedAt: row.visited_at, profile: profiles.get(row.viewer_profile_id) })).filter(row => row.profile);
  res.json({ likes, visits, counts: { likes: likes.length, visits: visits.length } });
}));

app.get('/api/projects', asyncRoute(async (req, res) => {
  let query = admin.from('projects').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(100);
  if (req.query.area) query = query.eq('area', String(req.query.area));
  const { data, error } = await query;
  if (error) throw error;
  const profiles = await rowsForProfiles((data || []).map(row => row.company_id));
  res.json({ projects: (data || []).map(row => ({ ...row, companyId: profiles.get(row.company_id) })) });
}));
app.post('/api/projects', authenticated, asyncRoute(async (req, res) => {
  if (req.auth.profile.profile_type !== 'company') return res.status(403).json({ error: 'Somente empresas podem publicar projetos.' });
  const body = req.body || {};
  if (!String(body.title || '').trim() || !String(body.description || '').trim() || !String(body.area || '').trim()) return res.status(400).json({ error: 'Título, descrição e área são obrigatórios.' });
  const { data, error } = await admin.from('projects').insert({ company_id: req.auth.profile.id, title: String(body.title).slice(0, 120), description: String(body.description).slice(0, 3000), area: String(body.area), skills: safeArray(body.skills), rate: Number(body.rate) || 0, work_modes: safeArray(body.workModes), city: req.auth.profile.city }).select('*').single();
  if (error) throw error;
  res.status(201).json({ project: { ...data, companyId: mapProfile(req.auth.profile) } });
}));
app.get('/api/lives', asyncRoute(async (_req, res) => {
  const { data, error } = await admin.from('lives').select('*').eq('status', 'live').order('started_at', { ascending: false }).limit(100);
  if (error) throw error;
  const profiles = await rowsForProfiles((data || []).map(row => row.host_profile_id));
  res.json({ lives: (data || []).map(row => ({ id: row.id, title: row.title, area: row.area, status: row.status, startedAt: row.started_at, host: profiles.get(row.host_profile_id), viewers: liveRooms.get(row.id)?.viewers.size || 0 })) });
}));
app.post('/api/lives', authenticated, asyncRoute(async (req, res) => {
  const title = String(req.body?.title || '').trim();
  if (title.length < 3) return res.status(400).json({ error: 'Informe um título para a live.' });
  const current = await admin.from('lives').select('id').eq('host_profile_id', req.auth.profile.id).eq('status', 'live').limit(1);
  if (current.error) throw current.error;
  if (current.data?.length) return res.status(409).json({ error: 'Você já tem uma live em andamento.' });
  const { data, error } = await admin.from('lives').insert({ host_profile_id: req.auth.profile.id, title: title.slice(0, 120), area: String(req.body.area || req.auth.profile.area).slice(0, 80) }).select('*').single();
  if (error) throw error;
  res.status(201).json({ live: { id: data.id, title: data.title, area: data.area, host: mapProfile(req.auth.profile), viewers: 0 } });
}));
app.delete('/api/lives/:id', authenticated, asyncRoute(async (req, res) => {
  const { data, error } = await admin.from('lives').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', req.params.id).eq('host_profile_id', req.auth.profile.id).eq('status', 'live').select('id').maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: 'Live ativa não encontrada.' });
  for (const viewer of liveRooms.get(data.id)?.viewers.values() || []) if (viewer.readyState === 1) { viewer.send(JSON.stringify({ type: 'ended' })); viewer.close(1000, 'Live encerrada'); }
  liveRooms.delete(data.id);
  res.status(204).end();
}));

app.post('/api/profiles/:targetId/interests', authenticated, asyncRoute(async (req, res) => {
  const from = req.auth.profile.id, to = req.params.targetId;
  if (from === to) return res.status(400).json({ error: 'Perfil de destino inválido.' });
  const target = await getProfile(to);
  if (!target) return res.status(404).json({ error: 'Perfil não encontrado.' });
  const { error: interestError } = await admin.from('interests').upsert({ from_profile_id: from, to_profile_id: to, decision: 'like', created_at: new Date().toISOString() }, { onConflict: 'from_profile_id,to_profile_id' });
  if (interestError) throw interestError;
  const reciprocal = await admin.from('interests').select('id').eq('from_profile_id', to).eq('to_profile_id', from).eq('decision', 'like').maybeSingle();
  if (reciprocal.error) throw reciprocal.error;
  if (!reciprocal.data) return res.status(202).json({ matched: false, message: 'Interesse registrado.' });
  const conversation = await createConversation(from, to, 'match');
  const [profile_a, profile_b] = pairIds(from, to);
  const { data: match, error } = await admin.from('matches').upsert({ pair_key: pairKey(from, to), profile_a, profile_b, conversation_id: conversation.id }, { onConflict: 'pair_key' }).select('*').single();
  if (error) throw error;
  res.status(201).json({ matched: true, matchId: match.id, conversationId: conversation.id });
}));
app.post('/api/profiles/:targetId/pass', authenticated, asyncRoute(async (req, res) => {
  if (req.params.targetId === req.auth.profile.id) return res.status(400).json({ error: 'Perfil de destino inválido.' });
  const { error } = await admin.from('interests').upsert({ from_profile_id: req.auth.profile.id, to_profile_id: req.params.targetId, decision: 'pass', created_at: new Date().toISOString() }, { onConflict: 'from_profile_id,to_profile_id' });
  if (error?.code === '23503') return res.status(404).json({ error: 'Perfil não encontrado.' });
  if (error) throw error;
  res.status(204).end();
}));
app.get('/api/matches', authenticated, asyncRoute(async (req, res) => {
  const id = req.auth.profile.id;
  const { data, error } = await admin.from('matches').select('*').or(`profile_a.eq.${id},profile_b.eq.${id}`).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  const profiles = await rowsForProfiles((data || []).flatMap(row => [row.profile_a, row.profile_b]));
  res.json({ matches: (data || []).map(row => ({ ...row, participants: [profiles.get(row.profile_a), profiles.get(row.profile_b)], conversationId: row.conversation_id })) });
}));
app.get('/api/conversations', authenticated, asyncRoute(async (req, res) => {
  const id = req.auth.profile.id;
  const { data, error } = await admin.from('conversations').select('*').or(`participant_a.eq.${id},participant_b.eq.${id}`).order('last_message_at', { ascending: false, nullsFirst: false }).limit(100);
  if (error) throw error;
  const profiles = await rowsForProfiles((data || []).flatMap(row => [row.participant_a, row.participant_b]));
  res.json({ conversations: (data || []).map(row => ({ id: row.id, participants: [profiles.get(row.participant_a), profiles.get(row.participant_b)], lastMessage: row.last_message, lastMessageAt: row.last_message_at, type: row.type })) });
}));
app.post('/api/conversations/direct/:targetId', authenticated, asyncRoute(async (req, res) => {
  if (!await getPro(req.auth.profile.id)) return res.status(403).json({ error: 'Envio de mensagem sem match está disponível no WorkerIN Pro.' });
  const targetId = req.params.targetId;
  if (targetId === req.auth.profile.id || !await getProfile(targetId)) return res.status(404).json({ error: 'Perfil de destino não encontrado.' });
  const conversation = await createConversation(req.auth.profile.id, targetId, 'direct', req.auth.profile.id);
  const profiles = await rowsForProfiles([conversation.participant_a, conversation.participant_b]);
  res.status(201).json({ conversation: { id: conversation.id, participants: [profiles.get(conversation.participant_a), profiles.get(conversation.participant_b)], lastMessage: conversation.last_message, lastMessageAt: conversation.last_message_at } });
}));
app.get('/api/internal/conversations/:id/access', serviceAuth, asyncRoute(async (req, res) => {
  const { data, error } = await admin.from('conversations').select('participant_a,participant_b').eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  const allowed = Boolean(data && [data.participant_a, data.participant_b].includes(String(req.query.userId)));
  res.status(allowed ? 200 : 403).json({ allowed });
}));
app.get('/chat/conversations/:id/messages', authenticated, asyncRoute(async (req, res) => {
  const { data: conversation, error: conversationError } = await admin.from('conversations').select('participant_a,participant_b').eq('id', req.params.id).maybeSingle();
  if (conversationError) throw conversationError;
  if (!conversation || ![conversation.participant_a, conversation.participant_b].includes(req.auth.profile.id)) return res.status(403).json({ error: 'Acesso à conversa negado.' });
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const { data, error } = await admin.from('messages').select('*').eq('conversation_id', req.params.id).order('sent_at', { ascending: false }).limit(limit);
  if (error) throw error;
  res.json({ messages: (data || []).map(row => ({ id: row.id, conversationId: row.conversation_id, senderId: row.sender_profile_id, content: row.content, sentAt: row.sent_at })) });
}));

app.post('/api/media/upload-url', authenticated, (req, res) => {
  const { filename, contentType } = req.body || {};
  if (!filename || !/^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime))$/.test(contentType || '')) return res.status(400).json({ error: 'Formato de mídia não aceito.' });
  const ext = path.extname(String(filename)).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10) || '.bin';
  const token = crypto.randomBytes(32).toString('hex'), key = `${req.auth.profile.id}/${crypto.randomUUID()}${ext}`;
  pendingUploads.set(token, { key, contentType, profileId: req.auth.profile.id, expiresAt: Date.now() + 15 * 60_000 });
  res.json({ uploadUrl: `/api/media/local/${token}`, objectKey: key, publicUrl: admin.storage.from(mediaBucket).getPublicUrl(key).data.publicUrl, expiresIn: 900, contentType });
});
app.put('/api/media/local/:token', express.raw({ type: () => true, limit: '25mb' }), asyncRoute(async (req, res) => {
  const pending = pendingUploads.get(req.params.token);
  if (!pending || pending.expiresAt < Date.now()) { pendingUploads.delete(req.params.token); return res.status(404).json({ error: 'URL de upload expirada.' }); }
  if (req.get('content-type') !== pending.contentType || !Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'O tipo do arquivo não confere.' });
  const { error } = await admin.storage.from(mediaBucket).upload(pending.key, req.body, { contentType: pending.contentType, cacheControl: '86400', upsert: false });
  if (error) throw error;
  pendingUploads.delete(req.params.token);
  res.status(204).end();
}));
app.get('/api/location/geocode', authenticated, (_req, res) => res.status(503).json({ error: 'Geocodificação requer uma chave Google Maps ou Mapbox.' }));
app.post('/api/internal/profiles/rank', serviceAuth, (req, res) => {
  const { candidates = [], requiredSkills = [], maxRate, maxDistanceKm } = req.body || {};
  const results = candidates.filter(item => item.available && (maxRate == null || item.hourlyRate <= maxRate) && (maxDistanceKm == null || item.distanceKm <= maxDistanceKm)).map(item => {
    const matchingSkills = (item.skills || []).filter(skill => requiredSkills.some(required => required.toLowerCase() === skill.toLowerCase()));
    const skill = requiredSkills.length ? matchingSkills.length / requiredSkills.length : 1;
    const distance = maxDistanceKm > 0 ? Math.max(0, 1 - item.distanceKm / maxDistanceKm) : 1;
    const price = maxRate > 0 ? Math.max(0, 1 - item.hourlyRate / maxRate) : 1;
    return { id: item.id, score: Math.round((skill * .6 + distance * .25 + price * .15) * 1000) / 1000, matchingSkills, distanceKm: item.distanceKm, hourlyRate: item.hourlyRate };
  }).sort((a, b) => b.score - a.score);
  res.json({ results, count: results.length });
});

app.post('/api/subscriptions/checkout', authenticated, asyncRoute(async (req, res) => {
  if (!mpToken) return res.status(503).json({ error: 'Configure MERCADOPAGO_ACCESS_TOKEN para ativar o checkout.' });
  if (!appBaseUrl.startsWith('https://')) return res.status(503).json({ error: 'Configure APP_BASE_URL com o endereço HTTPS publicado do app para receber webhooks do Mercado Pago.' });
  if (!mpWebhookSecret) return res.status(503).json({ error: 'Configure MERCADOPAGO_WEBHOOK_SECRET no servidor e no painel do Mercado Pago.' });
  if (await getPro(req.auth.profile.id)) return res.status(409).json({ error: 'Sua conta já tem WorkerIN Pro ativo.' });
  const pending = await openProSubscription(req.auth.profile.id);
  if (pending?.checkout_url) return res.json({ url: pending.checkout_url });
  const response = await fetch(`${mpApi}/preapproval`, { method: 'POST', headers: { authorization: `Bearer ${mpToken}`, 'content-type': 'application/json' }, body: JSON.stringify({
    reason: 'WorkerIN Pro - assinatura mensal', external_reference: req.auth.profile.id,
    payer_email: req.auth.user.email, auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: 7, currency_id: 'BRL' },
    back_url: `${appBaseUrl}/?pro=return`, status: 'pending',
  }) });
  const checkout = await response.json().catch(() => ({}));
  if (!response.ok || !checkout.id || !checkout.init_point) return res.status(502).json({ error: checkout.message || 'O Mercado Pago não conseguiu criar o checkout.' });
  const { error } = await admin.from('subscriptions').insert({ profile_id: req.auth.profile.id, provider: 'mercadopago', external_id: String(checkout.id), status: 'pending', price_brl: 7, checkout_url: checkout.init_point });
  if (error) throw error;
  res.json({ url: checkout.init_point });
}));
app.post('/api/payments/mercadopago/webhook', asyncRoute(async (req, res) => {
  if (!mpWebhookSecret || !validMercadoPagoSignature(req)) return res.status(401).json({ error: 'Assinatura de webhook inválida.' });
  const externalId = String(req.query['data.id'] || req.body?.data?.id || '');
  if (!externalId) return res.status(400).json({ error: 'Evento sem ID de assinatura.' });
  const response = await fetch(`${mpApi}/preapproval/${encodeURIComponent(externalId)}`, { headers: { authorization: `Bearer ${mpToken}` } });
  const subscription = await response.json().catch(() => ({}));
  if (!response.ok) return res.status(502).json({ error: 'Não foi possível confirmar o status no Mercado Pago.' });
  const profileId = String(subscription.external_reference || '');
  const amount = Number(subscription.auto_recurring?.transaction_amount);
  const currency = subscription.auto_recurring?.currency_id;
  if (!profileId || amount !== 7 || currency !== 'BRL') return res.status(400).json({ error: 'Assinatura não corresponde ao plano WorkerIN Pro.' });
  const status = ['authorized', 'active'].includes(subscription.status) ? 'authorized' : subscription.status;
  const { error } = await admin.from('subscriptions').upsert({ profile_id: profileId, provider: 'mercadopago', external_id: externalId, status, price_brl: 7, checkout_url: subscription.init_point || null, current_period_end: subscription.auto_recurring?.end_date || subscription.next_payment_date || null, last_event_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'external_id' });
  if (error) throw error;
  res.sendStatus(200);
}));

app.use((error, _req, res, _next) => {
  console.error('WorkerIN API:', error.message);
  res.status(error.status || (error.code === '23505' ? 409 : 500)).json({ error: error.status ? error.message : 'Erro no servidor WorkerIN. Confira as configurações e os logs.' });
});

server.on('upgrade', (req, socket, head) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
  const isLive = url.pathname === '/ws/live';
  if (!isLive && url.pathname !== '/ws') { socket.destroy(); return; }
  try {
    const identity = jwt.verify(url.searchParams.get('ticket') || '', jwtSecret, { issuer: 'workerin', audience: isLive ? 'workerin-live' : 'workerin-chat' });
    if (identity.purpose !== (isLive ? 'live' : 'ws')) throw new Error('Invalid ticket');
    if (isLive) {
      const sessionId = url.searchParams.get('sessionId'), role = url.searchParams.get('role');
      if (!sessionId || !['host', 'viewer'].includes(role)) throw new Error('Invalid live session');
      void admin.from('lives').select('id,host_profile_id').eq('id', sessionId).eq('status', 'live').maybeSingle().then(({ data }) => {
        if (!data || (role === 'host' && data.host_profile_id !== identity.profileId) || (role === 'viewer' && data.host_profile_id === identity.profileId)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, ws => { ws.profileId = identity.profileId; ws.sessionId = sessionId; ws.liveRole = role; wss.emit('live-connection', ws); });
      }).catch(() => { socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n'); socket.destroy(); });
      return;
    }
    const conversationId = url.searchParams.get('conversationId');
    void admin.from('conversations').select('participant_a,participant_b').eq('id', conversationId).maybeSingle().then(({ data }) => {
      if (!data || ![data.participant_a, data.participant_b].includes(identity.profileId)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => { ws.profileId = identity.profileId; ws.conversationId = conversationId; wss.emit('connection', ws); });
    }).catch(() => { socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n'); socket.destroy(); });
  } catch { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); }
});

wss.on('connection', ws => {
  const conversationId = ws.conversationId;
  if (!online.has(conversationId)) online.set(conversationId, new Set());
  online.get(conversationId).add(ws);
  ws.on('message', raw => {
    void (async () => {
      try {
        const input = JSON.parse(raw.toString()), content = String(input.content || '').trim();
        if (input.type !== 'message' || !content || [...content].length > 4000) { ws.send(JSON.stringify({ type: 'error', message: 'A mensagem deve conter de 1 a 4000 caracteres.' })); return; }
        const { data: message, error } = await admin.from('messages').insert({ conversation_id: conversationId, sender_profile_id: ws.profileId, content }).select('*').single();
        if (error) throw error;
        const sent = { id: message.id, conversationId, senderId: ws.profileId, content: message.content, sentAt: message.sent_at };
        await admin.from('conversations').update({ last_message: content, last_message_at: message.sent_at }).eq('id', conversationId);
        for (const peer of online.get(conversationId) || []) if (peer.readyState === 1) peer.send(JSON.stringify({ type: 'message', message: sent }));
      } catch { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message: 'Não foi possível salvar a mensagem.' })); }
    })();
  });
  ws.on('close', () => { online.get(conversationId)?.delete(ws); if (!online.get(conversationId)?.size) online.delete(conversationId); });
});

wss.on('live-connection', ws => {
  const id = ws.sessionId;
  if (!liveRooms.has(id)) liveRooms.set(id, { host: null, viewers: new Map() });
  const room = liveRooms.get(id);
  if (ws.liveRole === 'host') {
    if (room.host && room.host !== ws) room.host.close(1000, 'Nova conexão do host');
    room.host = ws;
    ws.send(JSON.stringify({ type: 'host-ready', viewers: room.viewers.size }));
  } else {
    room.viewers.set(ws.profileId, ws);
    if (room.host?.readyState === 1) room.host.send(JSON.stringify({ type: 'viewer-joined', viewerId: ws.profileId, viewers: room.viewers.size }));
    ws.send(JSON.stringify({ type: 'waiting-for-host' }));
  }
  ws.on('message', raw => {
    try {
      const event = JSON.parse(raw.toString());
      if (!['offer', 'answer', 'ice'].includes(event.type) || !event.targetId) return;
      const target = ws.liveRole === 'host' ? room.viewers.get(event.targetId) : room.host;
      if (target?.readyState === 1) target.send(JSON.stringify({ type: event.type, senderId: ws.profileId, payload: event.payload }));
    } catch { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message: 'Sinalização WebRTC inválida.' })); }
  });
  ws.on('close', () => {
    if (ws.liveRole === 'host') {
      if (room.host !== ws) return;
      room.host = null;
      void admin.from('lives').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', id).eq('status', 'live');
      for (const viewer of room.viewers.values()) if (viewer.readyState === 1) { viewer.send(JSON.stringify({ type: 'ended' })); viewer.close(1000, 'Host desconectado'); }
      liveRooms.delete(id);
    } else {
      if (room.viewers.get(ws.profileId) === ws) room.viewers.delete(ws.profileId);
      if (room.host?.readyState === 1) room.host.send(JSON.stringify({ type: 'viewer-left', viewerId: ws.profileId, viewers: room.viewers.size }));
      if (!room.host && !room.viewers.size) liveRooms.delete(id);
    }
  });
});

app.get('/', (_req, res) => res.sendFile(path.join(root, 'index.html')));
app.get('/index.html', (_req, res) => res.sendFile(path.join(root, 'index.html')));
app.get('/app.js', (_req, res) => res.type('application/javascript').sendFile(path.join(root, 'app.js')));
app.get('/styles.css', (_req, res) => res.type('text/css').sendFile(path.join(root, 'styles.css')));
for (const asset of ['workerin-symbol.svg', 'workerin-logo-dark.svg', 'workerin-logo-light.svg']) app.get(`/assets/${asset}`, (_req, res) => res.type('image/svg+xml').sendFile(path.join(root, 'assets', asset)));
server.listen(port, host, () => console.log(`WorkerIN conectado ao Supabase em http://${host}:${port}`));
