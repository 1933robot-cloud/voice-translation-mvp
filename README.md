# Voice Translation MVP

One-way live voice translation MVP:
- Speaker phone: speaks Russian
- OpenAI Realtime: translates and speaks English
- Listener phone: hears English audio streamed from the speaker device

## What is included
- Node.js backend
- Static mobile-friendly web UI
- Realtime token minting endpoint
- WebSocket signaling for room coordination
- Speaker page
- Listener page

## Important
This is a web app, not a native APK/IPA.
To use the microphone on a phone browser, serve it from a secure context (HTTPS). Localhost works for desktop development, but for phone testing you should deploy it to an HTTPS host or tunnel.

## Quick start
1. Install Node.js 20+
2. In the project folder run:
   npm install
3. Create a `.env` file from `.env.example`
4. Put your `OPENAI_API_KEY` into `.env`
5. Start the server:
   npm start
6. Open in a browser:
   http://localhost:3000

## Phone testing
Recommended:
- deploy to Render / Fly.io / Railway / any HTTPS host
- or run a secure tunnel like Cloudflare Tunnel / ngrok

Then on two phones:
- open the app
- create a room
- one device joins as Speaker
- second device joins as Listener
- tap Start Session on Speaker
- tap Enable Audio on Listener if autoplay is blocked

## Files
- `server.js` - backend + signaling + token route
- `public/index.html` - landing page
- `public/speaker.html` - speaker UI
- `public/listener.html` - listener UI
- `public/app.css` - styles
- `public/shared.js` - shared helpers
- `public/speaker.js` - speaker logic
- `public/listener.js` - listener logic


## Deploy-ready files included
- `render.yaml` - Render configuration
- `railway.json` - Railway configuration
- `Dockerfile` - container build for Fly.io or generic hosting
- `fly.toml` - Fly.io template
- `README_DEPLOY.md` - short deployment guide

## Important for hosting
Set `OPENAI_API_KEY` in the hosting platform environment variables.
Do not store it in frontend code or commit it into `.env` for public hosting.
