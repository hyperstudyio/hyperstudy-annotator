// The track bundle format (hyperstudy-perception schema/bundle-0.1) as the app reads it.
// Only fields the app uses are typed; layers carry more, which readers ignore. Ids are "<kind>:<local>" strings.

export type LicenceMode = 'academic-only' | 'commercial-ok' | 'needs-review' | 'api-terms';
export type Box = [number, number, number, number]; // x, y, w, h in source pixels
export type Kpt = [number, number, number];          // x, y, score (each layer states its score scale)

export interface FileEntry { file: string; sha256: string; bytes: number }

export interface Manifest {
  format: 'hyperstudy-perception-bundle';
  schema_version: string;
  created_at: string;
  video: { sha256: string; duration: number; fps: number; width: number; height: number; filename?: string };
  pipeline: { name: string; version: string; git_commit?: string | null; source?: string };
  layers: Record<string, FileEntry & { licence_mode: LicenceMode; stage: string; side_files?: FileEntry[] }>;
  assets?: FileEntry[];
}

export interface BundleSummary {
  id: string;
  title: string;
  video_sha256: string;
  schema_version: string;
  created_at: string | null;
  imported_at: string;
  layers: Record<string, LicenceMode>;
  video_path: string | null;
}

export interface Span { start: number; end: number }

export interface Model { id: string; source: string | null; revision: string | null; licence: string | null; licence_mode: LicenceMode }
export interface Producer {
  stage: string; stage_version: string; models: Model[]; config: Record<string, unknown>;
  device: string | null; run_at: string | null; timings: Record<string, unknown>;
}
export interface LayerBase { layer: string; schema_version: string; producer: Producer }

// --- shots, transcript, speakers --------------------------------------------------------------------------------

export interface Shot extends Span {
  id: string; index: number;
  caption: { description: string | null; setting?: string | null; mood?: string | null; model?: string } | null;
}
export interface ShotsLayer extends LayerBase { shots: Shot[] }

export interface Utterance extends Span { id: string; text: string; shot: string; voice: string | null }
export interface TranscriptLayer extends LayerBase { voices: { id: string }[]; utterances: Utterance[] }

/** Who speaks an utterance. Machine predictions and corrections share this shape. */
export type Speaker =
  | { kind: 'face'; face: string }             // a face track on screen
  | { kind: 'person'; person: string }         // a known person, off camera
  | { kind: 'offscreen'; voice: string | null }// a diarized voice with no face
  | { kind: 'multiple' } | { kind: 'unsure' } | { kind: 'not_speech' };

export interface SpeakerPrediction {
  utt: string;
  predicted: Speaker & { via?: string };
  candidates: { face: string; score: number }[];
  margin: number | null;
  second_opinion_agrees: boolean | null;
}
export interface SpeakersLayer extends LayerBase { utterances: SpeakerPrediction[] }

// --- faces --------------------------------------------------------------------------------------------------------

export interface FaceSample { t: number; box: Box; mouth?: number | null; gaze?: [number, number] | null }
export interface FaceTrack extends Span {
  id: string; person: string | null; shot: string; samples: FaceSample[]; crop?: string | null;
  linked_body?: boolean | null;
  summary?: { dominant_emotion?: string | null; head_yaw?: number | null };
}
export interface Person { id: string; first_seen: number | null; seconds_on_screen: number | null; crop: string | null; shots: string[] }
export interface FacesLayer extends LayerBase {
  sample_fps: number; people: Person[]; tracks: FaceTrack[];
  person_pairs: { a: string; b: string; distance: number; co_visible: boolean }[];
  detail: { file: string; fields: string[] } | null;
}
/** py-feat per sample (side file layers/faces_detail.json). lmk: 68 x then 68 y. Angles in radians. */
export interface FaceDetailSample { t: number; lmk: number[]; au: number[]; emo: number[]; va: [number, number]; head: [number, number, number]; gaze: [number, number] }
export interface FacesDetail { au_names: string[]; emotion_names: string[]; tracks: Record<string, FaceDetailSample[]> }

// --- bodies, hands, gestures, facing, gaze ------------------------------------------------------------------------

export interface PoseSample { t: number; box: Box; kpts: Kpt[]; facing?: [number, number | null] | null }
export interface BodyTrack extends Span { id: string; shot: string; face: string | null; link?: string; samples: PoseSample[] }
export interface BodiesLayer extends LayerBase {
  keypoint_names: string[]; skeleton: [number, number][]; score_threshold: number; fps: number; tracks: BodyTrack[];
}

export interface HandTrack extends Span {
  id: string; shot: string; side: 'left' | 'right' | null; body: string | null; face: string | null;
  box_source: string; samples: PoseSample[];
}
export interface HandsLayer extends LayerBase {
  keypoint_names: string[]; skeleton: [number, number][]; score_threshold: number | null; fps: number; hands: HandTrack[];
}

export interface GestureEvent extends Span { id: string; kind: string; face: string | null; hand?: string | null; score?: number; detail?: { target?: string | null } }
export interface GesturesLayer extends LayerBase { events: GestureEvent[] }

export interface FacingEvent extends Span { id: string; from: string; to: string; mutual: boolean; score?: number; detail?: { mean_angle_deg?: number } }
export interface FacingLayer extends LayerBase { events: FacingEvent[] }

export interface GazeSample { t: number; peak: [number, number] | null; in_frame: number | null; target: string | null; target_score?: number | null }
export interface GazeEvent extends Span { id: string; kind: 'looks_at' | 'mutual_gaze' | 'joint_attention' | string; from: string; to: string | null; object: string | null; also: string | null; score?: number }
export interface GazeLayer extends LayerBase { fps: number; tracks: { face: string; samples: GazeSample[] }[]; events: GazeEvent[] }

// --- objects ------------------------------------------------------------------------------------------------------

export interface ObjectSample { t: number; box: Box; poly: [number, number][]; score?: number }
export interface ObjectTrack extends Span { id: string; label: string; identity: string; shot: string; wearer?: string | null; samples: ObjectSample[] }
export interface ObjectIdentity { id: string; label: string; family?: string | null; worn_by: string[]; tracks: string[]; crop: string | null }
export interface ObjectsLayer extends LayerBase { fps: number; tracks: ObjectTrack[]; identities: ObjectIdentity[] }

// --- sounds, text, waveform ---------------------------------------------------------------------------------------

export interface SoundEvent extends Span { id: string; label: string; sources: string[]; agreement: boolean | null; score: number | null }
export interface SoundsLayer extends LayerBase { events: SoundEvent[] }

export interface TextItem extends Span { id: string; text: string; box: Box | null }
export interface TextLayer extends LayerBase { items: TextItem[] }

export interface WaveformLayer extends LayerBase { hz: number; peaks: number[] }

// --- prosody ------------------------------------------------------------------------------------------------------

export interface ProsodyMeasures {
  final_movement?: 'rise' | 'fall' | 'level' | null; final_delta_st?: number | null;
  f0_median_hz?: number | null; f0_range_st?: number | null; speech_rate_syl_s?: number | null;
  internal_pauses?: number | null; pause_before_s?: number | null; intensity_db?: number | null;
  hnr_db?: number | null; jitter_local?: number | null; shimmer_local?: number | null;
}
export interface Affect { arousal: number; valence: number; dominance: number }
/** A delivery caption. Audio models that tag (GPT audio) write `tags`; captioners that only describe (Qwen) have
 *  their description mapped onto the same tag set by a text tagger, as `tags_from_text`. */
export interface ProsodyCaption { description: string | null; tags?: string[]; tags_from_text?: string[]; emphasized_words?: string[] }
export interface ProsodyUtterance {
  utt: string; speaker: string | null; speaker_source: string | null; measures: ProsodyMeasures;
  words: { word: string; prominence?: number | null }[];
  emotion: Record<string, Affect | unknown>;
  captions: Record<string, ProsodyCaption>;
}
export interface ProsodyLayer extends LayerBase {
  contour: { step: number; t0: number; speakers: string[]; f0_st: (number | null)[]; speaker: (number | null)[] };
  default_dimensional: string | null;
  emotion_models: Record<string, { model: string; licence_mode: LicenceMode; kind: 'dimensional' | 'categorical' }>;
  caption_models: Record<string, { model: string; licence_mode: LicenceMode }>;
  utterances: ProsodyUtterance[];
}
