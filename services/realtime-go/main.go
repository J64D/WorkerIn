package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gocql/gocql"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

type claims struct {
	ProfileID string `json:"profileId"`
	Purpose   string `json:"purpose"`
	jwt.RegisteredClaims
}

type message struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversationId"`
	SenderID       string    `json:"senderId"`
	Content        string    `json:"content"`
	SentAt         time.Time `json:"sentAt"`
}

var (
	jwtSecret  = []byte(os.Getenv("JWT_SECRET"))
	serviceKey = []byte(os.Getenv("SERVICE_TOKEN"))
	redisClient *redis.Client
	cassandra *gocql.Session
	upgrader = websocket.Upgrader{ReadBufferSize: 2048, WriteBufferSize: 2048, CheckOrigin: checkOrigin, Subprotocols: []string{"workerin.chat.v1"}}
)

func checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" { return true }
	for _, allowed := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		if strings.TrimSpace(allowed) == origin { return true }
	}
	return false
}

func authorizeTicket(raw string) (*claims, error) {
	token, err := jwt.ParseWithClaims(raw, &claims{}, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 { return nil, errors.New("unexpected token signing method") }
		return jwtSecret, nil
	}, jwt.WithIssuer("workerin"), jwt.WithAudience("workerin-chat"))
	if err != nil { return nil, err }
	result, ok := token.Claims.(*claims)
	if !ok || !token.Valid || result.Purpose != "ws" || result.ProfileID == "" { return nil, errors.New("invalid websocket ticket") }
	return result, nil
}

func authorizedConversation(ctx context.Context, conversationID, profileID string) bool {
	url := strings.TrimRight(os.Getenv("API_INTERNAL_URL"), "/") + "/api/internal/conversations/" + conversationID + "/access?userId=" + profileID
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil { return false }
	req.Header.Set("x-service-token", os.Getenv("SERVICE_TOKEN"))
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil { return false }
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func parseAccessToken(raw string) (*claims, error) {
	token, err := jwt.ParseWithClaims(raw, &claims{}, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 { return nil, errors.New("unexpected token signing method") }
		return jwtSecret, nil
	}, jwt.WithIssuer("workerin"))
	if err != nil { return nil, err }
	result, ok := token.Claims.(*claims)
	if !ok || !token.Valid || result.ProfileID == "" { return nil, errors.New("invalid access token") }
	return result, nil
}

func historyHandler(w http.ResponseWriter, r *http.Request) {
	conversationID := r.PathValue("conversationID")
	raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	identity, err := parseAccessToken(raw)
	if err != nil { http.Error(w, "authentication required", http.StatusUnauthorized); return }
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	allowed := authorizedConversation(ctx, conversationID, identity.ProfileID)
	cancel()
	if !allowed { http.Error(w, "conversation access denied", http.StatusForbidden); return }
	limit := 50
	if requested := r.URL.Query().Get("limit"); requested != "" { if n, parseErr := strconv.Atoi(requested); parseErr == nil { limit = max(1, min(n, 100)) } }
	iter := cassandra.Query(`SELECT message_id, sender_id, content, sent_at FROM messages_by_conversation WHERE conversation_id = ? LIMIT ?`, conversationID, limit).Iter()
	rows := make([]message, 0, limit)
	var id, sender, content string
	var sentAt time.Time
	for iter.Scan(&id, &sender, &content, &sentAt) { rows = append(rows, message{ID:id, ConversationID:conversationID, SenderID:sender, Content:content, SentAt:sentAt}) }
	if err := iter.Close(); err != nil { http.Error(w, "message history unavailable", http.StatusServiceUnavailable); return }
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"messages": rows})
}

func writeJSON(conn *websocket.Conn, mu *sync.Mutex, value any) error {
	mu.Lock()
	defer mu.Unlock()
	_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return conn.WriteJSON(value)
}

func chatHandler(w http.ResponseWriter, r *http.Request) {
	conversationID := r.URL.Query().Get("conversationId")
	ticket := r.URL.Query().Get("ticket")
	if conversationID == "" || ticket == "" { http.Error(w, "conversationId and a short-lived ticket are required", http.StatusUnauthorized); return }
	identity, err := authorizeTicket(ticket)
	if err != nil { http.Error(w, "invalid or expired ticket", http.StatusUnauthorized); return }
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	allowed := authorizedConversation(ctx, conversationID, identity.ProfileID)
	cancel()
	if !allowed { http.Error(w, "conversation access denied", http.StatusForbidden); return }
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil { return }
	defer conn.Close()
	conn.SetReadLimit(16 * 1024)
	_ = conn.SetReadDeadline(time.Now().Add(75 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(75 * time.Second)) })

	channel := "conversation:" + conversationID
	pubsub := redisClient.Subscribe(r.Context(), channel)
	defer pubsub.Close()
	if _, err := pubsub.Receive(r.Context()); err != nil { _ = writeJSON(conn, &sync.Mutex{}, map[string]string{"type":"error", "message":"chat service temporarily unavailable"}); return }
	writeMu := &sync.Mutex{}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for event := range pubsub.Channel() {
			var payload message
			if json.Unmarshal([]byte(event.Payload), &payload) != nil { continue }
			if err := writeJSON(conn, writeMu, map[string]any{"type":"message", "message":payload}); err != nil { return }
		}
	}()

	for {
		var input struct { Type string `json:"type"`; Content string `json:"content"` }
		if err := conn.ReadJSON(&input); err != nil { break }
		if input.Type == "ping" { _ = writeJSON(conn, writeMu, map[string]string{"type":"pong"}); continue }
		content := strings.TrimSpace(input.Content)
		if input.Type != "message" || content == "" || len([]rune(content)) > 4000 { _ = writeJSON(conn, writeMu, map[string]string{"type":"error", "message":"message must contain 1–4000 characters"}); continue }
		createdAt := time.Now().UTC()
		id := gocql.TimeUUID()
		entry := message{ID:id.String(), ConversationID:conversationID, SenderID:identity.ProfileID, Content:content, SentAt:createdAt}
		if cassandra != nil {
			if err := cassandra.Query(`INSERT INTO messages_by_conversation (conversation_id, created_at, message_id, sender_id, content, sent_at) VALUES (?, ?, ?, ?, ?, ?)`, conversationID, id, entry.ID, identity.ProfileID, content, createdAt).Exec(); err != nil { log.Printf("cassandra message write: %v", err); _ = writeJSON(conn, writeMu, map[string]string{"type":"error", "message":"message could not be stored"}); continue }
		}
		body, _ := json.Marshal(entry)
		if err := redisClient.Publish(r.Context(), channel, body).Err(); err != nil { log.Printf("redis message publish: %v", err); _ = writeJSON(conn, writeMu, map[string]string{"type":"error", "message":"message could not be delivered"}) }
		_ = redisClient.Set(r.Context(), "presence:"+identity.ProfileID, time.Now().UTC().Format(time.RFC3339), 2*time.Minute).Err()
	}
	select { case <-done: case <-time.After(100 * time.Millisecond): }
}

func serviceMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		a := []byte(r.Header.Get("x-service-token"))
		if len(a) != len(serviceKey) || subtle.ConstantTimeCompare(a, serviceKey) != 1 { http.Error(w, "unauthorized", http.StatusUnauthorized); return }
		next(w, r)
	}
}

func main() {
	if len(jwtSecret) < 32 || len(serviceKey) < 32 { log.Fatal("JWT_SECRET and SERVICE_TOKEN must each contain at least 32 characters") }
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	redisClient = redis.NewClient(&redis.Options{Addr: envOr("REDIS_ADDR", "localhost:6379")})
	if err := redisClient.Ping(ctx).Err(); err != nil { log.Fatalf("connect Redis: %v", err) }
	cluster := gocql.NewCluster(strings.Split(envOr("CASSANDRA_HOSTS", "localhost"), ",")...)
	cluster.Keyspace = "workerin"
	cluster.Consistency = gocql.LocalQuorum
	cluster.Timeout = 5 * time.Second
	var err error
	cassandra, err = cluster.CreateSession()
	if err != nil { log.Fatalf("connect Cassandra: %v", err) }
	defer cassandra.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, _ *http.Request) { w.Header().Set("content-type", "application/json"); _, _ = w.Write([]byte(`{"status":"ok","service":"workerin-realtime"}`)) })
	mux.HandleFunc("GET /health/ready", serviceMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if err := redisClient.Ping(r.Context()).Err(); err != nil || cassandra.Closed() { http.Error(w, "not ready", http.StatusServiceUnavailable); return }
		w.Header().Set("content-type", "application/json"); _, _ = w.Write([]byte(`{"status":"ready","redis":true,"cassandra":true}`))
	}))
	mux.HandleFunc("GET /ws", chatHandler)
	mux.HandleFunc("GET /chat/conversations/{conversationID}/messages", historyHandler)
	port := envOr("PORT", "8081")
	log.Printf("WorkerIN realtime listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func envOr(key, fallback string) string { if value := os.Getenv(key); value != "" { return value }; return fallback }
