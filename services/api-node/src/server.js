import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient } from 'redis';
import { Client as ElasticClient } from '@elastic/elasticsearch';
import { Client as MinioClient } from 'minio';

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'local-development-secret-change-me';
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || 'local-service-token-change-me';
const PROFILE_INDEX = 'workerin_profiles_v1';
const app = express();
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:4173').split(',').map(x => x.trim()), credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));

const userSchema = new mongoose.Schema({ email: { type: String, required: true, unique: true, lowercase: true, trim: true }, passwordHash: { type: String, required: true }, profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' } }, { timestamps: true });
const profileSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  slug: { type: String, unique: true, sparse: true },
  profileType: { type: String, enum: ['freelancer', 'company'], required: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  gender: { type: String, enum: ['Mulheres', 'Homens', 'Outro', 'Prefiro não informar'], default: undefined },
  age: { type: Number, min: 18, max: 100 },
  role: { type: String, required: true, maxlength: 120 },
  area: { type: String, required: true, maxlength: 80 },
  city: { type: String, required: true, maxlength: 120 },
  location: { type: { type: String, enum: ['Point'], default: undefined }, coordinates: { type: [Number], default: undefined } },
  rate: { type: Number, required: true, min: 0, max: 100000 },
  workModes: [{ type: String, enum: ['Remoto', 'Híbrido', 'Presencial'] }],
  skills: [{ type: String, maxlength: 50 }],
  bio: { type: String, maxlength: 1200, default: '' },
  photos: [{ type: String }],
  introMedia: { type: { type: String, enum: ['video', 'gif'] }, src: String },
  available: { type: Boolean, default: true },
  verified: { type: Boolean, default: false },
  portfolio: [{ type: String, maxlength: 120 }]
}, { timestamps: true });
profileSchema.index({ location: '2dsphere' });
profileSchema.index({ profileType: 1, area: 1, rate: 1, available: 1 });
const interestSchema = new mongoose.Schema({ from: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true }, to: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true }, decision: { type: String, enum: ['like', 'pass'], default: 'like' } }, { timestamps: true });
interestSchema.index({ from: 1, to: 1 }, { unique: true });
const matchSchema = new mongoose.Schema({ participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true }], projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' }, conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' } }, { timestamps: true });
matchSchema.index({ participants: 1 });
const conversationSchema = new mongoose.Schema({ participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true }], matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match' }, lastMessage: { type: String, default: '' }, lastMessageAt: Date }, { timestamps: true });
const projectSchema = new mongoose.Schema({ companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true }, title: { type: String, required: true, maxlength: 120 }, description: { type: String, required: true, maxlength: 3000 }, area: { type: String, required: true }, skills: [String], rate: { type: Number, min: 0 }, workModes: [String], city: String, status: { type: String, enum: ['open', 'paused', 'closed'], default: 'open' } }, { timestamps: true });
const User = mongoose.model('User', userSchema);
const Profile = mongoose.model('Profile', profileSchema);
const Interest = mongoose.model('Interest', interestSchema);
const Match = mongoose.model('Match', matchSchema);
const Conversation = mongoose.model('Conversation', conversationSchema);
const Project = mongoose.model('Project', projectSchema);

const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.on('error', err => console.error('Redis:', err.message));
let elastic;
if (process.env.ELASTICSEARCH_URL) elastic = new ElasticClient({ node: process.env.ELASTICSEARCH_URL, requestTimeout: 1500, maxRetries: 1 });
const minio = new MinioClient({ endPoint: process.env.MINIO_ENDPOINT || 'localhost', port: Number(process.env.MINIO_PORT || 9000), useSSL: process.env.MINIO_USE_SSL === 'true', accessKey: process.env.MINIO_ACCESS_KEY || 'workerin', secretKey: process.env.MINIO_SECRET_KEY || 'workerin-local-secret' });
const minioPresigner = new MinioClient({ endPoint: process.env.MINIO_PUBLIC_ENDPOINT || process.env.MINIO_ENDPOINT || 'localhost', port: Number(process.env.MINIO_PUBLIC_PORT || process.env.MINIO_PORT || 9000), useSSL: (process.env.MINIO_PUBLIC_URL || '').startsWith('https://'), accessKey: process.env.MINIO_ACCESS_KEY || 'workerin', secretKey: process.env.MINIO_SECRET_KEY || 'workerin-local-secret' });
const mediaBucket = process.env.MINIO_BUCKET || 'workerin-media';

function publicProfile(doc, distanceKm) {
  const p = doc.toObject ? doc.toObject() : doc;
  return { id: String(p._id), profileType: p.profileType, name: p.name, gender: p.gender, age: p.age, role: p.role, area: p.area, city: p.city, distance: distanceKm ?? p.distanceKm ?? 0, rate: p.rate, work: p.workModes || [], skills: p.skills || [], bio: p.bio || '', photo: p.photos?.[0] || '', photos: p.photos || [], introMedia: p.introMedia?.src ? { type: p.introMedia.type, src: p.introMedia.src } : null, available: p.available, verified: p.verified, portfolio: p.portfolio || [] };
}
function searchDocument(p) {
  const item = p.toObject ? p.toObject() : p;
  return { profileType: item.profileType, gender: item.gender, name: item.name, role: item.role, area: item.area, city: item.city, rate: item.rate, workModes: item.workModes, skills: item.skills, bio: item.bio, photos: item.photos, introMedia: item.introMedia, available: item.available, verified: item.verified, portfolio: item.portfolio, location: item.location?.coordinates?.length === 2 ? { lat: item.location.coordinates[1], lon: item.location.coordinates[0] } : undefined };
}
async function indexProfile(p) { if (!elastic) return; try { await elastic.index({ index: PROFILE_INDEX, id: String(p._id), document: searchDocument(p), refresh: false }); } catch (e) { console.warn('Elasticsearch index skipped:', e.message); } }
function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Autenticação necessária.' });
  try { req.auth = jwt.verify(token, JWT_SECRET); next(); } catch { return res.status(401).json({ error: 'Token inválido ou expirado.' }); }
}
function serviceAuth(req, res, next) { if (req.get('x-service-token') !== SERVICE_TOKEN) return res.status(401).json({ error: 'Serviço não autorizado.' }); next(); }
function asyncRoute(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }
function validCoordinates(lat, lon) { return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180; }

async function ensureSearchIndex() {
  if (!elastic) return;
  try {
    const exists = await elastic.indices.exists({ index: PROFILE_INDEX });
    if (!exists) await elastic.indices.create({ index: PROFILE_INDEX, mappings: { properties: { profileType: { type: 'keyword' }, gender: { type: 'keyword' }, area: { type: 'keyword' }, city: { type: 'keyword' }, workModes: { type: 'keyword' }, skills: { type: 'keyword' }, rate: { type: 'integer' }, available: { type: 'boolean' }, location: { type: 'geo_point' }, name: { type: 'text' }, role: { type: 'text' } } } });
  } catch (e) { console.warn('Elasticsearch unavailable; discovery will use MongoDB:', e.message); }
}

async function seedDemoProfiles() {
  if (process.env.DEMO_SEED !== 'true') return;
  const point = [-46.65, -23.56];
  const rows = [
    { slug: 'demo-luiza', profileType: 'freelancer', gender: 'Mulheres', age: 29, name: 'Luiza Almeida', role: 'Product Designer · UX/UI', area: 'Produto & UX/UI', city: 'Pinheiros, São Paulo', location: { type: 'Point', coordinates: point }, rate: 145, workModes: ['Híbrido', 'Remoto'], skills: ['UX Research', 'Figma', 'Design System'], bio: 'Transformo problemas complexos em experiências digitais simples e humanas.', photos: ['https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=900&q=85'], available: true, verified: true, portfolio: ['Redesign de produto financeiro', 'Aplicativo de saúde digital'] },
    { slug: 'demo-rafael', profileType: 'freelancer', gender: 'Homens', age: 32, name: 'Rafael Nunes', role: 'Engenheiro de Software · Full Stack', area: 'Engenharia de software', city: 'Vila Madalena, São Paulo', location: { type: 'Point', coordinates: [-46.69, -23.55] }, rate: 180, workModes: ['Remoto', 'Híbrido'], skills: ['React', 'Node.js', 'AWS'], bio: 'Construo aplicações escaláveis do primeiro protótipo à produção.', photos: ['https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=900&q=85'], available: true, verified: true, portfolio: ['Plataforma de pagamentos', 'Marketplace de serviços'] },
    { slug: 'demo-nexopay', profileType: 'company', name: 'NexoPay', role: 'Fintech · Produto e pagamentos', area: 'Engenharia de software', city: 'Faria Lima, São Paulo', location: { type: 'Point', coordinates: [-46.68, -23.57] }, rate: 220, workModes: ['Híbrido', 'Remoto'], skills: ['React', 'Node.js', 'Pagamentos'], bio: 'Estamos ampliando nosso time para construir experiências financeiras mais simples. Procuramos parceria para evoluir nosso app e plataforma web.', photos: ['https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=900&q=85'], available: true, verified: true, portfolio: ['Aplicativo financeiro', 'Plataforma de pagamentos'] },
    { slug: 'demo-orbita', profileType: 'company', name: 'Orbita Studio', role: 'Estúdio digital · Produtos web e mobile', area: 'Produto & UX/UI', city: 'Pinheiros, São Paulo', location: { type: 'Point', coordinates: [-46.69, -23.56] }, rate: 190, workModes: ['Remoto', 'Híbrido'], skills: ['UX/UI', 'Figma', 'Design de produto'], bio: 'Estúdio independente criando produtos digitais para marcas em crescimento.', photos: ['https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=900&q=85'], available: true, verified: true, portfolio: ['E-commerce de moda', 'App de mobilidade'] }
  ];
  for (const row of rows) { const p = await Profile.findOneAndUpdate({ slug: row.slug }, { $setOnInsert: row }, { upsert: true, new: true }); await indexProfile(p); }
}

app.get('/api/health/live', (_req, res) => res.json({ status: 'ok', service: 'workerin-api' }));
app.get('/api/health/ready', asyncRoute(async (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  let redisOk = false; try { redisOk = (await redis.ping()) === 'PONG'; } catch {}
  let searchOk = false; try { if (elastic) searchOk = (await elastic.ping()).statusCode === 200; } catch {}
  res.status(mongoOk && redisOk ? 200 : 503).json({ status: mongoOk && redisOk ? 'ready' : 'degraded', mongo: mongoOk, redis: redisOk, elasticsearch: searchOk });
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const { email, password, profileType, name, role, area, city, rate } = req.body;
  if (!email || !password || password.length < 10 || !['freelancer', 'company'].includes(profileType) || !name || !role || !area || !city || !Number.isFinite(Number(rate))) return res.status(400).json({ error: 'Informe e-mail, senha com 10+ caracteres e os dados básicos do perfil.' });
  if (profileType === 'freelancer' && Number(req.body.age) < 18) return res.status(400).json({ error: 'O WorkerIN é destinado a pessoas maiores de 18 anos.' });
  if (await User.exists({ email: email.toLowerCase() })) return res.status(409).json({ error: 'Este e-mail já possui cadastro.' });
  const user = await User.create({ email, passwordHash: await bcrypt.hash(password, 12) });
  try {
    const profile = await Profile.create({ ownerId: user._id, profileType, name, gender: profileType === 'freelancer' ? req.body.gender : undefined, age: profileType === 'freelancer' ? Number(req.body.age) : undefined, role, area, city, rate: Number(rate), workModes: req.body.workModes || [], skills: req.body.skills || [], bio: req.body.bio || '', photos: req.body.photos || [], introMedia: req.body.introMedia, available: true, location: validCoordinates(Number(req.body.lat), Number(req.body.lon)) ? { type: 'Point', coordinates: [Number(req.body.lon), Number(req.body.lat)] } : undefined });
    user.profileId = profile._id; await user.save(); await indexProfile(profile);
    const token = jwt.sign({ sub: String(user._id), profileId: String(profile._id), profileType }, JWT_SECRET, { expiresIn: '12h', issuer: 'workerin' });
    res.status(201).json({ token, profile: publicProfile(profile) });
  } catch (error) { await User.findByIdAndDelete(user._id); throw error; }
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const user = await User.findOne({ email: String(req.body.email || '').toLowerCase() });
  if (!user || !await bcrypt.compare(String(req.body.password || ''), user.passwordHash)) return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  const profile = await Profile.findById(user.profileId);
  const token = jwt.sign({ sub: String(user._id), profileId: String(user.profileId), profileType: profile?.profileType }, JWT_SECRET, { expiresIn: '12h', issuer: 'workerin' });
  res.json({ token, profile: profile ? publicProfile(profile) : null });
}));
app.post('/api/auth/ws-ticket', auth, (_req, res) => {
  const ticket = jwt.sign({ sub: _req.auth.sub, profileId: _req.auth.profileId, purpose: 'ws' }, JWT_SECRET, { expiresIn: '60s', issuer: 'workerin', audience: 'workerin-chat' });
  res.json({ ticket, expiresIn: 60 });
});

app.get('/api/profiles/discover', asyncRoute(async (req, res) => {
  const radiusKm = Math.min(Math.max(Number(req.query.radiusKm || 50), 1), 500);
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  const hasPoint = validCoordinates(lat, lon);
  const filter = { available: req.query.available !== 'false' };
  let excludeProfileId;
  if (req.headers.authorization?.startsWith('Bearer ')) {
    try { const identity = jwt.verify(req.headers.authorization.slice(7), JWT_SECRET); excludeProfileId = identity.profileId; filter._id = { $ne: identity.profileId }; } catch {}
  }
  if (['freelancer', 'company'].includes(req.query.type)) filter.profileType = req.query.type;
  if (req.query.gender && ['Mulheres', 'Homens', 'Outro', 'Prefiro não informar'].includes(req.query.gender)) { filter.profileType = 'freelancer'; filter.gender = req.query.gender; }
  if (req.query.area) filter.area = String(req.query.area);
  if (req.query.city) filter.city = { $regex: String(req.query.city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (req.query.workMode) filter.workModes = String(req.query.workMode);
  if (Number.isFinite(Number(req.query.maxRate))) filter.rate = { $lte: Number(req.query.maxRate) };
  let profiles = [];
  if (elastic) {
    try {
      const filters = Object.entries(filter).filter(([key]) => key !== '_id').flatMap(([key, value]) => {
        if (key === 'rate') return [{ range: { rate: { lte: value.$lte } } }];
        if (key === 'city') return [{ wildcard: { city: { value: `*${String(req.query.city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}*`, case_insensitive: true } } }];
        return [{ term: { [key]: value } }];
      });
      if (hasPoint) filters.push({ geo_distance: { distance: `${radiusKm}km`, location: { lat, lon } } });
      const result = await elastic.search({ index: PROFILE_INDEX, size: 100, query: { bool: { filter: filters, ...(excludeProfileId ? { must_not: [{ ids: { values: [excludeProfileId] } }] } : {}) } }, ...(hasPoint ? { sort: [{ _geo_distance: { location: { lat, lon }, order: 'asc', unit: 'km', mode: 'min', distance_type: 'arc' } }] } : {}) });
      profiles = result.hits.hits.map(hit => ({ ...hit._source, _id: hit._id, distanceKm: hasPoint ? Number(hit.sort?.[0] ?? 0) : 0 }));
    } catch (e) { console.warn('Search fallback to MongoDB:', e.message); }
  }
  if (!profiles.length) {
    if (hasPoint) {
      const docs = await Profile.aggregate([{ $geoNear: { near: { type: 'Point', coordinates: [lon, lat] }, distanceField: 'distanceMeters', maxDistance: radiusKm * 1000, spherical: true, query: filter } }, { $limit: 100 }]);
      profiles = docs.map(p => ({ ...p, distanceKm: Math.round(p.distanceMeters / 100) / 10 }));
    } else profiles = await Profile.find(filter).sort({ updatedAt: -1 }).limit(100).lean();
  }
  res.json({ profiles: profiles.map(p => publicProfile(p, p.distanceKm)), count: profiles.length, radiusKm, source: elastic && profiles.length ? 'elasticsearch' : 'mongodb' });
}));

app.get('/api/profiles/me', auth, asyncRoute(async (req, res) => { const p = await Profile.findById(req.auth.profileId); if (!p) return res.status(404).json({ error: 'Perfil não encontrado.' }); res.json({ profile: publicProfile(p) }); }));
app.get('/api/profiles/:id', asyncRoute(async (req, res) => { if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID inválido.' }); const p = await Profile.findById(req.params.id); if (!p) return res.status(404).json({ error: 'Perfil não encontrado.' }); res.json({ profile: publicProfile(p) }); }));
app.patch('/api/profiles/me', auth, asyncRoute(async (req, res) => {
  const allowed = ['name', 'gender', 'age', 'role', 'area', 'city', 'rate', 'workModes', 'skills', 'bio', 'photos', 'introMedia', 'available', 'portfolio'];
  const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  if (req.auth.profileType === 'company') { delete update.gender; delete update.age; }
  const p = await Profile.findByIdAndUpdate(req.auth.profileId, { $set: update }, { new: true, runValidators: true });
  if (!p) return res.status(404).json({ error: 'Perfil não encontrado.' }); await indexProfile(p); res.json({ profile: publicProfile(p) });
}));

app.post('/api/projects', auth, asyncRoute(async (req, res) => {
  if (req.auth.profileType !== 'company') return res.status(403).json({ error: 'Somente empresas podem publicar projetos.' });
  const { title, description, area } = req.body;
  if (!title || !description || !area) return res.status(400).json({ error: 'Título, descrição e área são obrigatórios.' });
  const project = await Project.create({ ...req.body, companyId: req.auth.profileId, status: 'open' }); res.status(201).json({ project });
}));
app.get('/api/projects', asyncRoute(async (req, res) => { const projects = await Project.find({ status: 'open', ...(req.query.area ? { area: req.query.area } : {}) }).sort({ createdAt: -1 }).limit(100).populate('companyId', 'name profileType city'); res.json({ projects }); }));

app.post('/api/profiles/:targetId/interests', auth, asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.targetId) || String(req.params.targetId) === req.auth.profileId) return res.status(400).json({ error: 'Perfil de destino inválido.' });
  const target = await Profile.findById(req.params.targetId); if (!target) return res.status(404).json({ error: 'Perfil de destino não encontrado.' });
  const from = new mongoose.Types.ObjectId(req.auth.profileId);
  await Interest.updateOne({ from, to: target._id }, { $set: { decision: 'like' } }, { upsert: true });
  const reciprocal = await Interest.exists({ from: target._id, to: from, decision: 'like' });
  if (!reciprocal) return res.status(202).json({ matched: false, message: 'Interesse registrado.' });
  let conversation = await Conversation.findOne({ participants: { $all: [from, target._id] } });
  if (!conversation) conversation = await Conversation.create({ participants: [from, target._id] });
  const match = await Match.findOneAndUpdate({ participants: { $all: [from, target._id] } }, { $setOnInsert: { participants: [from, target._id], conversationId: conversation._id } }, { upsert: true, new: true });
  conversation.matchId = match._id; await conversation.save();
  if (process.env.SCALA_ANALYTICS_URL) fetch(`${process.env.SCALA_ANALYTICS_URL}/internal/analytics/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': SERVICE_TOKEN }, body: JSON.stringify({ type: 'match_created', at: new Date().toISOString() }) }).catch(() => {});
  res.status(201).json({ matched: true, matchId: String(match._id), conversationId: String(conversation._id) });
}));
app.post('/api/profiles/:targetId/pass', auth, asyncRoute(async (req, res) => { if (!mongoose.isValidObjectId(req.params.targetId) || String(req.params.targetId) === req.auth.profileId) return res.status(400).json({ error: 'Perfil de destino inválido.' }); const to = new mongoose.Types.ObjectId(req.params.targetId); await Interest.updateOne({ from: req.auth.profileId, to }, { $set: { decision: 'pass' } }, { upsert: true }); res.status(204).end(); }));
app.get('/api/matches', auth, asyncRoute(async (req, res) => { const rows = await Match.find({ participants: req.auth.profileId }).sort({ createdAt: -1 }).populate('participants', 'name profileType role photos city').populate('conversationId'); res.json({ matches: rows }); }));
app.get('/api/conversations', auth, asyncRoute(async (req, res) => { const rows = await Conversation.find({ participants: req.auth.profileId }).sort({ lastMessageAt: -1, updatedAt: -1 }).populate('participants', 'name profileType role photos'); res.json({ conversations: rows }); }));
app.get('/api/internal/conversations/:id/access', serviceAuth, asyncRoute(async (req, res) => { const conversation = await Conversation.findById(req.params.id).select('participants'); if (!conversation || !conversation.participants.some(p => String(p) === String(req.query.userId))) return res.status(403).json({ allowed: false }); res.json({ allowed: true }); }));

app.post('/api/media/upload-url', auth, asyncRoute(async (req, res) => {
  const { filename, contentType } = req.body;
  const allowed = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime))$/;
  if (!filename || !allowed.test(contentType || '')) return res.status(400).json({ error: 'Formato de mídia não aceito.' });
  const ext = String(filename).split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
  const objectName = `${req.auth.profileId}/${crypto.randomUUID()}.${ext}`;
  const uploadUrl = await minioPresigner.presignedPutObject(mediaBucket, objectName, 15 * 60);
  res.json({ uploadUrl, objectKey: objectName, publicUrl: `${(process.env.MINIO_PUBLIC_URL || 'http://localhost:9000').replace(/\/$/, '')}/${mediaBucket}/${objectName}`, expiresIn: 900, contentType });
}));

app.get('/api/location/geocode', auth, asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim(); if (q.length < 2 || q.length > 120) return res.status(400).json({ error: 'Informe uma localidade válida.' });
  if (process.env.MAPS_PROVIDER === 'google' && process.env.GOOGLE_MAPS_API_KEY) {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json'); url.searchParams.set('address', q); url.searchParams.set('key', process.env.GOOGLE_MAPS_API_KEY); url.searchParams.set('language', 'pt-BR');
    const data = await (await fetch(url)).json(); if (data.status !== 'OK' || !data.results?.length) return res.status(404).json({ error: 'Localidade não encontrada.' }); const r = data.results[0]; return res.json({ label: r.formatted_address, lat: r.geometry.location.lat, lon: r.geometry.location.lng });
  }
  if (process.env.MAPS_PROVIDER === 'mapbox' && process.env.MAPBOX_ACCESS_TOKEN) {
    const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`); url.searchParams.set('access_token', process.env.MAPBOX_ACCESS_TOKEN); url.searchParams.set('language', 'pt'); url.searchParams.set('limit', '1');
    const data = await (await fetch(url)).json(); const r = data.features?.[0]; if (!r) return res.status(404).json({ error: 'Localidade não encontrada.' }); return res.json({ label: r.place_name, lon: r.center[0], lat: r.center[1] });
  }
  res.status(503).json({ error: 'Configure MAPS_PROVIDER e uma chave de API no ambiente.' });
}));

app.post('/api/internal/profiles/rank', serviceAuth, asyncRoute(async (req, res) => {
  const response = await fetch(`${process.env.JAVA_RANKING_URL || 'http://localhost:8090'}/internal/matches/rank`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req.body) });
  if (!response.ok) return res.status(502).json({ error: 'Motor de ranking indisponível.' }); res.status(response.status).json(await response.json());
}));

app.use((err, _req, res, _next) => { console.error(err); if (err?.code === 11000) return res.status(409).json({ error: 'Registro duplicado.' }); if (err?.name === 'ValidationError') return res.status(400).json({ error: err.message }); res.status(500).json({ error: 'Erro interno do WorkerIN.' }); });

async function start() {
  await mongoose.connect(process.env.MONGO_URL || 'mongodb://localhost:27017/workerin', { serverSelectionTimeoutMS: 5000 });
  await redis.connect(); await ensureSearchIndex(); await seedDemoProfiles();
  app.listen(PORT, '0.0.0.0', () => console.log(`WorkerIN API listening on ${PORT}`));
}
start().catch(error => { console.error('Unable to start WorkerIN API:', error); process.exit(1); });
