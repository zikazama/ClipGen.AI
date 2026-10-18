# ClipGen.AI

**From one sentence to a cinematic 20-second clip.** ClipGen.AI is a text-to-video web studio built on
Google's **Veo 3.1** and **Gemini**. Describe a scene (optionally anchor it with a start and end image),
and it generates a clip, extends it to up to 20 seconds, masters a 1080p MP4 and can mix in AI narration.

- **Live app:** https://project-5869a4b9-e007-42d4-b48.web.app
- **Cloud Run service (`clipgen`):** https://clipgen-173461988236.us-central1.run.app

## Features

| Feature | How it works |
|---|---|
| Text-to-video | Prompt goes to Veo 3.1 (Fast or HQ) on Vertex AI, which also generates the clip's own sound. |
| Dual keyframe anchors | Optional start and end images. The start frame opens the clip; the end frame anchors the first 8 seconds. For 15s/20s clips the extension then continues the story from that end frame. |
| Up to 20-second clips | Veo makes an 8s opening clip, then each extension adds 7s (8 → 15 → 22). The result is trimmed to the length you picked. Lengths: 4, 6, 8, 15, 20s. |
| 33 presets | One-click looks and motion styles (Cinematic, Product, Social, Motion, Style) that steer the prompt. |
| Fast and HQ modes | `veo-3.1-fast-generate-001` for drafts, `veo-3.1-generate-001` for finals. |
| 1080p master | Native 1080p from Veo (also through extensions), encoded with ffmpeg to a social-ready H.264/AAC MP4. 1080p needs a clip length of 8s or more. |
| AI narration | Gemini 2.5 text-to-speech (6 voices), mixed over the clip while its own audio is ducked. Preview the voice before generating. |
| Prompt enhancer | Gemini 2.5 Flash rewrites a rough idea into a director-grade Veo prompt. |
| Instant access | Firebase Auth: Google sign-in, email/password, or **guest** (anonymous) with no sign-up wall. A guest who signs in keeps their clips. |
| Library | Your clips are stored per user and listed in the Library tab. A running job survives closing the tab. |

## How it uses Google Cloud and Firebase

| Service | Role |
|---|---|
| **Gemini** (Vertex AI) | Gemini 2.5 TTS for narration; Gemini 2.5 Flash for the prompt enhancer. |
| **Veo 3.1** (Vertex AI) | Video generation and extension, with native audio. |
| **Cloud Run** | The `clipgen` service: REST API, job orchestration and ffmpeg mastering. Scales to zero. |
| **Firestore** | Job state (the generation state machine), per-user clip library, and persistent rate limits / daily budget counters. |
| **Firebase Auth** | Google, email and anonymous (guest) sign-in. The API verifies the Firebase ID token on every request. |
| **Firebase Hosting** | Serves the web app and rewrites `/api/**` to the Cloud Run service. |
| **Cloud Storage** | Veo output, intermediate extension segments and final MP4s (served through short-lived signed URLs; lifecycle rules auto-delete old files). |

### Architecture

```
Browser (React + Vite)
   │  Firebase Auth (Google / email / guest)  ── ID token
   ▼
Firebase Hosting ──/api/**──► Cloud Run: clipgen (Express + ffmpeg)
                                   │
        ┌──────────────────────────┼─────────────────────────────┐
        ▼                          ▼                             ▼
  Vertex AI                    Firestore                   Cloud Storage
  Veo 3.1 (generate/extend)    jobs · users/*/clips        segments + final MP4
  Gemini TTS / Flash           ratelimits · budget
```

### Generation pipeline

`POST /api/jobs` validates the request, enforces limits, starts the Veo base clip and stores a job in Firestore.
The browser then polls `GET /api/jobs/:id`; each poll advances the job **at most one step** (guarded by a
Firestore lease, so concurrent polls are safe and no background compute is needed):

1. **Base clip** – Veo generates 4/6/8s (with start/end frames if given) into Cloud Storage.
2. **Extend ×N** – for 15s/20s, Veo extends the previous clip by 7s per step (output is the merged video).
3. **Master** – ffmpeg trims to the requested length, encodes H.264/AAC and, if requested, mixes in the Gemini narration.
4. **Done** – the MP4 is saved, a clip record is written to Firestore and the UI gets a signed URL.

## Cost and abuse controls

The API is public, so cost is capped in layers (all counters live in Firestore, so they hold across instances):

| Guard | Default | Env var |
|---|---|---|
| Video jobs per IP per hour | 10 | `GEN_PER_IP_HOUR` |
| Generated seconds per guest per day | 30 | `GUEST_SECONDS_PER_DAY` |
| Generated seconds per signed-in user per day | 120 | `USER_SECONDS_PER_DAY` |
| Global daily budget (estimated USD) | 15 | `DAILY_BUDGET_USD` |
| Gemini helper calls per user per hour | 30 | `AI_CALLS_PER_HOUR` |

Also: Cloud Run `max-instances=3`, a Cloud Billing budget alert, strict input validation (model allow-list, image
type/size, bounded text), sanitized error messages and deny-all Firestore rules (the browser never touches Firestore directly).

Estimated Veo list prices used for the budget guard: Fast about $0.10/s (720p) and $0.12/s (1080p), HQ about
$0.40/s. A 20s clip generates 22s of video: roughly $2.6 on Fast 1080p or $8.8 on HQ. **Verify current prices before budgeting.**

## Project layout

```
index.tsx            App shell: auth state, landing ↔ studio
src/Landing.tsx      Landing page
src/Studio.tsx       Studio UI (prompt, presets, keyframes, length, narration, progress, library)
src/AuthModal.tsx    Google / email / guest sign-in
src/firebase.ts      Firebase Auth helpers (guest → account upgrade)
src/api.ts           Typed, authenticated API client
src/presets.ts       The 33 presets
utils.ts             Audio helpers (PCM decode, shared AudioContext)
server/index.js      Express routes
server/lib/          pipeline (job state machine), veo, gemini, media (ffmpeg), limits, firebase, config
firebase.json        Hosting (rewrites /api to Cloud Run) + Firestore rules
Dockerfile           Builds the frontend, installs ffmpeg, runs the server
```

## Run and deploy

Prerequisites: Node.js 20+, a Google Cloud project with billing, `gcloud` and `firebase` CLIs.

```bash
npm install
npm run dev        # Vite dev server on http://127.0.0.1:3000, proxying /api to the deployed Cloud Run service
npm test           # vitest unit tests
npm run build
```

One-time project setup (already done for the demo project):

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  aiplatform.googleapis.com firestore.googleapis.com storage.googleapis.com identitytoolkit.googleapis.com
gcloud firestore databases create --location=us-central1
gcloud storage buckets create gs://clipgen-<PROJECT_ID>-media --location=us-central1 --uniform-bucket-level-access
# Runtime service account needs: roles/aiplatform.user, roles/datastore.user,
# roles/storage.objectAdmin on the bucket, and roles/iam.serviceAccountTokenCreator on itself (signed URLs).
```

Deploy:

```bash
gcloud run deploy clipgen --source . --region us-central1 --allow-unauthenticated \
  --cpu 2 --memory 2Gi --timeout 300 --max-instances 3
firebase deploy --only firestore:rules,hosting
```

To use another project, change `PROJECT_ID` defaults in `server/lib/config.js` (or set `GOOGLE_CLOUD_PROJECT` /
`MEDIA_BUCKET`) and the Firebase web config in `src/firebase.ts`. In the Firebase console enable the
**Google** sign-in provider (email and anonymous are enabled via API).

## Known limitations

- A 15s/20s clip's **end frame anchors the first 8 seconds**, not the final frame, because Veo extension cannot take a new end frame.
- Seams between extension blocks are produced by Veo's continuation; most are smooth, but a visible change is possible on busy scenes.
- Veo and Gemini are billed per use; there is no free API tier for Veo. A failed or blocked generation still counts against the daily guard.
- Veo prompts are English-only; clips and narration are best kept short.
