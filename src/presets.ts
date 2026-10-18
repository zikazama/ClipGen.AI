export interface Preset {
  id: string;
  name: string;
  category: 'Cinematic' | 'Product' | 'Social' | 'Motion' | 'Style';
  /** Appended to the user's prompt to steer look and camera. */
  style: string;
}

export const PRESET_CATEGORIES = ['Cinematic', 'Product', 'Social', 'Motion', 'Style'] as const;

export const PRESETS: Preset[] = [
  // Cinematic
  { id: 'epic-cinematic', name: 'Epic Cinematic', category: 'Cinematic', style: 'epic cinematic film look, anamorphic lens, shallow depth of field, dramatic lighting, rich color grade' },
  { id: 'film-noir', name: 'Film Noir', category: 'Cinematic', style: 'black and white film noir, hard shadows, venetian blind light, smoky atmosphere, slow dolly' },
  { id: 'golden-hour', name: 'Golden Hour', category: 'Cinematic', style: 'warm golden hour sunlight, long soft shadows, lens flare, gentle handheld movement' },
  { id: 'blockbuster-trailer', name: 'Blockbuster Trailer', category: 'Cinematic', style: 'high-budget movie trailer shot, sweeping crane move, volumetric light, deep contrast' },
  { id: 'indie-drama', name: 'Indie Drama', category: 'Cinematic', style: '35mm grain, natural window light, intimate handheld framing, muted palette' },
  { id: 'sci-fi', name: 'Sci-Fi', category: 'Cinematic', style: 'futuristic science fiction, neon accents, holographic UI glow, sleek tracking shot' },
  { id: 'fantasy-epic', name: 'Fantasy Epic', category: 'Cinematic', style: 'high fantasy landscape, mist and god rays, majestic wide establishing shot, orchestral mood' },
  // Product
  { id: 'product-hero', name: 'Product Hero', category: 'Product', style: 'premium product commercial, glossy studio lighting, slow orbit around the product, clean reflections' },
  { id: 'minimal-studio', name: 'Minimal Studio', category: 'Product', style: 'minimalist seamless backdrop, soft diffused light, precise macro details, calm slow push-in' },
  { id: 'unboxing', name: 'Unboxing', category: 'Product', style: 'top-down unboxing shot, tidy desk, satisfying hand movements, bright even light' },
  { id: 'luxury-brand', name: 'Luxury Brand', category: 'Product', style: 'luxury brand film, black and gold palette, silky slow motion, elegant rim lighting' },
  { id: 'food-closeup', name: 'Food Close-up', category: 'Product', style: 'appetizing food macro, steam rising, glistening textures, shallow depth of field' },
  { id: 'tech-launch', name: 'Tech Launch', category: 'Product', style: 'modern tech keynote visual, floating device, light sweeps on edges, dark gradient background' },
  { id: 'fashion-lookbook', name: 'Fashion Lookbook', category: 'Product', style: 'editorial fashion lookbook, confident movement, wind in fabric, stylish rack focus' },
  // Social
  { id: 'tiktok-hook', name: 'TikTok Hook', category: 'Social', style: 'vertical social video, bold first-second hook, punchy fast camera moves, vibrant saturated colors' },
  { id: 'vlog', name: 'Vlog', category: 'Social', style: 'casual vlog selfie framing, handheld, natural daylight, friendly energetic feel' },
  { id: 'comedy-skit', name: 'Comedy Skit', category: 'Social', style: 'lighthearted comedic timing, exaggerated reactions, bright flat lighting, quick cuts feel' },
  { id: 'ugc-review', name: 'UGC Review', category: 'Social', style: 'authentic user-generated style, phone camera look, real home setting, honest tone' },
  { id: 'travel-reel', name: 'Travel Reel', category: 'Social', style: 'travel reel, sweeping landscape reveal, drone-like glide, vivid blue skies' },
  { id: 'fitness-motivation', name: 'Fitness Motivation', category: 'Social', style: 'gritty gym motivation, dramatic backlight, sweat detail, powerful slow motion' },
  // Motion
  { id: 'drone-flyover', name: 'Drone Flyover', category: 'Motion', style: 'smooth aerial drone flyover, high altitude, forward glide, crisp detail' },
  { id: 'slow-motion', name: 'Slow Motion', category: 'Motion', style: 'ultra slow motion at 1000 fps look, droplets and particles suspended, high shutter clarity' },
  { id: 'timelapse', name: 'Time-lapse', category: 'Motion', style: 'time-lapse, clouds and light moving fast, locked-off tripod, dramatic sky' },
  { id: 'whip-pan', name: 'Whip Pan', category: 'Motion', style: 'energetic whip pans and match cuts, dynamic transitions, rhythmic movement' },
  { id: 'orbit', name: 'Orbit Shot', category: 'Motion', style: 'smooth 360-degree orbit around the subject, steady gimbal, subject stays centered' },
  { id: 'dolly-zoom', name: 'Dolly Zoom', category: 'Motion', style: 'vertigo dolly zoom effect, background stretches while the subject stays fixed in frame' },
  // Style
  { id: 'anime', name: 'Anime', category: 'Style', style: 'high-quality anime style, hand-drawn look, expressive lighting, painterly clouds' },
  { id: 'pixar-3d', name: '3D Animated', category: 'Style', style: 'polished 3D animated feature look, soft subsurface scattering, charming character design' },
  { id: 'claymation', name: 'Claymation', category: 'Style', style: 'stop-motion claymation, tactile fingerprints on clay, slightly jittery frame rate' },
  { id: 'vintage-vhs', name: 'Vintage VHS', category: 'Style', style: '1980s VHS camcorder look, tracking lines, soft bloom, warm faded colors' },
  { id: 'watercolor', name: 'Watercolor', category: 'Style', style: 'animated watercolor painting, bleeding pigments, visible paper texture, dreamy movement' },
  { id: 'cyberpunk', name: 'Cyberpunk', category: 'Style', style: 'rainy cyberpunk city at night, neon reflections on wet streets, dense signage, moody haze' },
  { id: 'documentary', name: 'Documentary', category: 'Style', style: 'natural documentary realism, observational handheld, available light, subtle ambient sound' },
];

export const findPreset = (id: string | null) => PRESETS.find(p => p.id === id) || null;

/** Combines the user's prompt with a preset's style description. */
export function composePrompt(prompt: string, preset: Preset | null): string {
  const base = prompt.trim().replace(/[.\s]+$/, '');
  if (!preset) return prompt.trim();
  return base ? `${base}. Style: ${preset.style}.` : `${preset.style}.`;
}
