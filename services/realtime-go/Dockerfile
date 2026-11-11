FROM golang:1.27.3-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/realtime ./

FROM alpine:3.22
RUN addgroup -S workerin && adduser -S workerin -G workerin
COPY --from=build /out/realtime /usr/local/bin/realtime
USER workerin
EXPOSE 8081
ENTRYPOINT ["/usr/local/bin/realtime"]
