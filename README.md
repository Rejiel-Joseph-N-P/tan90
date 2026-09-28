# tan90

A self-hosted, invite-only video streaming platform. There are no open sign-ups: everything goes through one central request-and-approval system. People request access, an admin reviews and approves, and only then can they watch. All media stays on my own server.

## What makes it different

- **Centralised access control.** Access requests, subscription requests, video requests and upload requests all flow through a single admin panel, so one person controls who gets in and what gets added.
- **Fully self-hosted.** It runs on my own Ubuntu server with Docker Compose. No third-party streaming service, and the media library never leaves my storage.

## Features

- Access request flow with admin approval
- Subscriber accounts with paid subscriptions (PayU) and scheduled renewal reminders
- Video and upload requests from users, managed by the admin
- Media library served through Jellyfin, with series and shorts pages
- Subtitle lookup via OpenSubtitles
- Background transcoding
- Email notifications (Gmail SMTP) and a password reset flow

## Architecture

```
Browser -> nginx -> static frontend (HTML/JS)
                 -> Node.js API -> PostgreSQL
                                -> Jellyfin (media)
                                -> PayU, Gmail SMTP, OpenSubtitles
```

Four containers: `tan90-nginx`, `tan90-app`, `tan90-postgres`, `tan90-jellyfin`.

## Setup

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/config.example.js frontend/config.js   # fill in your values
mkdir -p uploads                                    # or symlink to your storage
docker compose up -d --build
docker exec -i tan90-postgres psql -U "$DB_USER" -d "$DB_NAME" < backend/schema.sql
SEED_PASSWORD='choose-one' node backend/createAdmin.js
```

## Security notes

- Secrets live in `.env` files, which are gitignored. Only `.env.example` templates are committed.
- `frontend/config.js`, database dumps and the `uploads/` directory are not in the repo.
- Rotate any key that has ever been visible to a browser.

## Operations

The platform is monitored by [tan90-agent](https://github.com/Rejiel-Joseph-N-P/tan90-agent), a small read-only ops agent that uses a local LLM to check containers, logs, disk, RAM and database health.

## Status

A personal project running on a single home server.
