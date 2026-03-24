# Deploy-ready guide

This project is prepared for:
- Render
- Railway
- Fly.io

## Required environment variable
Set this on the hosting platform:

`OPENAI_API_KEY=your_openai_api_key`

Do not put the API key into frontend files.

## Render
1. Create a new Web Service.
2. Upload this project or connect the repo.
3. Render will detect `render.yaml`.
4. Add `OPENAI_API_KEY` in Environment.
5. Deploy.

## Railway
1. Create a new project.
2. Upload the folder or connect repo.
3. Railway will use `railway.json`.
4. Add `OPENAI_API_KEY` in Variables.
5. Deploy.

## Fly.io
1. Install Fly CLI.
2. Change `app = "voice-translation-mvp"` in `fly.toml` to your unique app name.
3. Run:
   `fly launch --no-deploy`
4. Set secret:
   `fly secrets set OPENAI_API_KEY=your_openai_api_key`
5. Deploy:
   `fly deploy`

## Phone use
Open the deployed HTTPS URL on two phones:
- device 1: create room and open as Speaker
- device 2: open as Listener
- on Speaker press `Start session`
- on Listener press `Enable audio` if autoplay is blocked

## Health check
`/api/health`
