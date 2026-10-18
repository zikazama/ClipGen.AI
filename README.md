# ClipGen.AI

**One product photo. One line. A 20-second ad, ready to post.** ClipGen.AI makes product ads for SMEs (UMKM) and
online sellers. Upload a photo of what you sell and write a short brief; **Gemini** acts as the creative director
(Veo prompt, voice-over script, caption, hashtags), **Veo 3.1** shoots the clip, and a **local-language voice**
narrates it, ready for TikTok, Reels, Shopee Video or Shorts. A free-form mode (prompt, presets, start/end frames)
is there for everything else.

- **Live app:** https://project-5869a4b9-e007-42d4-b48.web.app
- **Cloud Run service (`clipgen`):** https://clipgen-173461988236.us-central1.run.app

## Why not a generic AI video tool?

| | |
|---|---|
| Built for sellers | The product photo becomes the first frame; output is a vertical, ready-to-post ad. |
| No prompt skills | Gemini writes the prompt and script from a one-line brief and your brand kit. 33 presets for manual control. |
| Local-language voice | Gemini TTS voice-over in Bahasa Indonesia and English; Javanese and Sundanese in beta. |
| Low cost per ad | About $2.65 of API cost for a 20 s Fast ad with narration; see [Cost model](#cost-model). |

## Features

| Feature | How it works |
|---|---|
| **Gemini creative director** | Brief + product photo + brand kit in; Veo prompt, voice-over script (length-capped for the clip), social caption and hashtags out, as validated JSON from Gemini 2.5 Flash. You can edit everything before generating. |
| **Narration in four languages** | Gemini 2.5 TTS (6 voices, 4 speaking styles). Bahasa Indonesia and English are supported by Gemini TTS; Javanese and Sundanese are **beta** (not on Google's official TTS list; transcribing the audio back with Gemini returned the script verbatim, but pronunciation has not been reviewed by native speakers). |
| **Brand kits (Firestore)** | Per-user logo, colours, tone and audience. The tone and colours steer Gemini; the logo is overlaid on the video with ffmpeg. |
| **History and gallery** | Every ad is saved per user with its brief, script, caption, hashtags, settings and cost; copy the caption or re-download any time. |
| Up to 20-second clips | Veo makes an 8 s opening clip and each extension adds 7 s (8 → 15 → 22), trimmed to the length you pick. Lengths: 4, 6, 8, 15, 20 s. |
| Dual keyframes (free-form) | Optional start and end image. The end frame anchors the first 8 seconds; for 15 s and 20 s clips the extension then continues the story. |
| Platform presets | TikTok, Instagram Reels, Shopee Video, YouTube Shorts, Facebook/website set the aspect ratio and a suggested length. |
| 33 presets | One-click looks and motion styles (Cinematic, Product, Social, Motion, Style) in free-form mode. |
| Fast and HQ | `veo-3.1-fast-generate-001` for drafts, `veo-3.1-generate-001` for finals. |
| 1080p master | Native 1080p from Veo (also through extensions), encoded with ffmpeg to H.264/AAC. 1080p needs a clip length of 8 s or more. Photos are cropped to the video ratio so Veo never letterboxes them. |
| Sound on/off | Veo generates its own sound by default; switching it off uses Google's cheaper video-only rate. |
| Instant access | Firebase Auth: Google, email/password, or **guest**. A guest who signs in keeps their clips. |

### Guest trial and accounts

Guests can make **one Fast draft up to 8 seconds per day** (our cost about $0.96). HQ and longer clips need a Google or
email account. Signed-in users get a larger daily allowance (default 120 generated seconds per day).

## How it uses Google Cloud and Firebase

| Service | Role |
|---|---|
| **Gemini** (Vertex AI) | Gemini 2.5 Flash is the creative director (multimodal: it looks at the product photo) and the prompt enhancer; Gemini 2.5 TTS narrates. |
| **Veo 3.1** (Vertex AI) | Video generation and extension, with native audio. |
| **Cloud Run** | The `clipgen` service: REST API, job orchestration and ffmpeg mastering. Scales to zero. |
| **Firestore** | Core product data: `jobs` (generation state machine), `users/{uid}/clips` (history and gallery), `users/{uid}/brandKits` (brand kits), and `ratelimits` (shared quotas and the daily budget). |
| **Firebase Auth** | Google, email and anonymous (guest) sign-in. The API verifies the Firebase ID token on every request. |
| **Firebase Hosting** | Serves the web app and rewrites `/api/**` to the Cloud Run service. |
| **Cloud Storage** | Veo output, intermediate extension segments, brand logos and final MP4s, served through short-lived signed URLs; lifecycle rules delete intermediates after 1 day and finals after 30 days. |

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
  Veo 3.1 (generate/extend)    jobs · clips · brandKits    segments · logos · final MP4
  Gemini Flash (director)      ratelimits · budget
  Gemini TTS (narration)
```

### Generation pipeline

`POST /api/jobs` validates the request, applies the guest/user limits, starts the Veo base clip and stores a job in
Firestore. The browser then polls `GET /api/jobs/:id`; each poll advances the job **at most one step** (guarded by a
Firestore lease, so concurrent polls are safe and no background compute is needed):

1. **Base clip**: Veo generates 4/6/8 s (from the product photo or start/end frames) into Cloud Storage.
2. **Extend x N**: for 15 s and 20 s, Veo extends the previous clip by 7 s per step (the output is the merged video).
3. **Master**: ffmpeg trims to the length, encodes H.264/AAC, mixes in the Gemini narration (ducking Veo's own sound) and overlays the brand logo.
4. **Done**: the MP4 is saved, a clip record (with brief, script, caption, cost) is written to Firestore and the UI gets a signed URL.

### API

All routes require `Authorization: Bearer <Firebase ID token>`.

| Route | Purpose |
|---|---|
| `POST /api/director` | Creative director: brief + product photo + brand kit → prompt, script, caption, hashtags |
| `POST /api/jobs`, `GET /api/jobs/:id` | Start a video job, poll (and advance) it |
| `GET/DELETE /api/clips[/:id]` | History and gallery |
| `GET/POST/PUT/DELETE /api/brandkits[/:id]`, `PUT /api/brandkits/:id/logo` | Brand kits |
| `POST /api/enhance`, `POST /api/tts` | Prompt enhancer and voice preview |

## Cost model

Cost is estimated from Google list prices and shown before you generate (`src/pricing.ts` on the client,
`server/lib/pricing.js` on the server; a unit test keeps the two identical). **Verify current prices before budgeting.**

| Cost item (1080p) | Price | One 20 s ad* |
|---|---|---|
| Veo 3.1 Fast, with sound | $0.12 / s | $2.65 |
| Veo 3.1 HQ, with sound | $0.40 / s | $8.81 |
| Veo 3.1 Fast, video only | $0.10 / s | $2.21 |
| Veo 3.1 HQ, video only | $0.20 / s | $4.41 |
| Gemini 2.5 Flash TTS (20 s voice-over) | audio tokens | about $0.005 |
| Gemini 2.5 Flash director | text tokens | about $0.002 |

\*A 20 s ad is built from **22 s** of generated video (8 s + two 7 s extensions, trimmed), so it is billed for 22 s.
Totals include narration and the director. 720p Fast is $0.10/s. Hosting is not included.

Pricing is per ad, not per second:

| Offer | Price | Gross margin on a Fast ad |
|---|---|---|
| Guest trial | Free: 1 Fast 8 s draft (cost $0.96, acquisition cost) | n/a |
| Credit pack | $40 / 10 ads ($4.00 per Fast ad; an HQ ad is 3 credits, $12) | 34% (HQ: 27%) |
| Seller plan | $99 / month, 30 Fast ads ($3.30 each) | 20% |

Margin = (price − API cost) / price, before hosting, payment fees and taxes.

### Abuse and cost controls

The API is public, so spend is capped in layers (all counters live in Firestore, so they hold across instances):

| Guard | Default | Env var |
|---|---|---|
| Video jobs per IP per hour | 10 | `GEN_PER_IP_HOUR` |
| Generated seconds per guest per day (and Fast-only, ≤ 8 s) | 8 | `GUEST_SECONDS_PER_DAY` |
| Generated seconds per signed-in user per day | 120 | `USER_SECONDS_PER_DAY` |
| Global daily budget (estimated USD) | 15 | `DAILY_BUDGET_USD` |
| Gemini helper calls per user per hour | 30 | `AI_CALLS_PER_HOUR` |

Also: Cloud Run `max-instances=3`, a Cloud Billing budget alert, strict input validation (model allow-list, image
type/size, bounded text, brand-kit limits), sanitized error messages and deny-all Firestore rules (the browser never
touches Firestore directly).

## Project layout

```
index.tsx              App shell: auth state, landing ↔ studio
src/Landing.tsx        Landing page (positioning, how it works, unit economics)
src/Studio.tsx         Studio: product-ad mode, free-form mode, progress, library
src/BrandKitModal.tsx  Brand kit editor (logo, colours, tone)
src/PricingPanel.tsx   Unit economics table and offers
src/AuthModal.tsx      Google / email / guest sign-in
src/firebase.ts        Firebase Auth helpers (guest → account upgrade)
src/api.ts             Typed, authenticated API client
src/ad.ts              Languages, platforms, speaking styles
src/pricing.ts         Cost model and unit economics
src/presets.ts         The 33 presets
src/image.ts           Photo crop/downscale and logo preparation
utils.ts               Audio helpers (PCM decode, shared AudioContext)
server/index.js        Express routes
server/lib/            pipeline (job state machine), veo, gemini (director, TTS), brand, media (ffmpeg), limits, pricing, firebase, config
firebase.json          Hosting (rewrites /api to Cloud Run) + Firestore rules
Dockerfile             Builds the frontend, installs ffmpeg, runs the server
```

## Run and deploy

Prerequisites: Node.js 20+, a Google Cloud project with billing, `gcloud` and `firebase` CLIs.

```bash
npm install
npm run dev        # Vite dev server on http://127.0.0.1:3000, proxying /api to the deployed Cloud Run service
npm test           # vitest unit tests
npm run build
```

The backend uses **Vertex AI with the Cloud Run service account**, so there is no Gemini API key to configure. Running
the server locally needs Application Default Credentials (`gcloud auth application-default login`).

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

To use another project, change the `PROJECT_ID` default in `server/lib/config.js` (or set `GOOGLE_CLOUD_PROJECT` /
`MEDIA_BUCKET`) and the Firebase web config in `src/firebase.ts`. In the Firebase console enable the **Google**
sign-in provider (email and anonymous can be enabled via API) and add your Cloud Run URL to **Authorized domains**.

## Measured results

From the prototype's own test runs (Veo 3.1 Fast, small sample; not a formal benchmark):

| Metric | Observed |
|---|---|
| Time to a finished 4 s clip with narration | about 85 s |
| Time to a finished 8 s product ad (with logo and narration) | about 70 s |
| Time to a finished 20 s, 1080p clip (two extensions, narration) | about 7 min |
| Output | 1920×1080 or 720×1280, H.264 + AAC, exact requested length |
| Start and end keyframes | start frame at 0.2 s, end frame reached at about 8 s |

## Known limitations

- A 15 s or 20 s clip's **end frame anchors the first 8 seconds**, not the final frame, because Veo extension cannot take a new end frame.
- There is no separate neural upscaler: 1080p comes natively from Veo and is encoded with ffmpeg.
- Narration is mixed over the clip starting at 0.5 s; it is not lip-synced.
- Seams between extension blocks come from Veo's continuation; most are smooth, but a change is possible on busy scenes.
- Javanese and Sundanese voice-over are beta and unreviewed by native speakers.
- Veo and Gemini are billed per use and Veo has no free API tier; a failed or blocked generation still counts against the daily guard.
- Veo prompts are English-only (the director writes the English prompt for you).
