/** Shared types exchanged with the Rust (Tauri) backend. */

export type FileKind = 'image' | 'pdf';

export interface InputFile {
  path: string;
  name: string;
  size: number; // bytes
  pages?: number;
  kind: FileKind;
  error?: string;
  /** Pixel dimensions for images. */
  width?: number;
  height?: number;
}

export interface OutputFile {
  name: string;
  path: string;
  size: number; // bytes
  badge?: string;
}

export interface OperationResult {
  files: OutputFile[];
  outDir: string;
  /** True when the user stopped the job before it finished. */
  stopped?: boolean;
}

export type ConflictPolicy = 'keep' | 'overwrite' | 'ask';
export type ThemeChoice = 'system' | 'light' | 'dark';

export interface AppSettings {
  /** Empty means the default folder, Documents/PDF Toolbox. */
  outputFolder: string;
  askEveryTime: boolean;
  onConflict: ConflictPolicy;
  theme: ThemeChoice;
  autoUpdate: boolean;
}

/** A recently opened input, remembered in localStorage. */
export interface RecentInput {
  path: string;
  name: string;
  size: number;
  /** Unix millis. */
  opened: number;
}

export interface ProgressPayload {
  processed: number;
  total: number;
  message?: string;
}

/** A file listed on the dashboard (recent output). */
export interface RecentFile {
  name: string;
  path: string;
  size: number;
  /** Unix millis. */
  modified: number;
}

/* ------------------------------- options --------------------------------- */

export type ImagePageSize = 'a4' | 'letter' | 'fit';
export type ImageOrientation = 'auto' | 'portrait' | 'landscape';

export interface ImagesOptions {
  pageSize: ImagePageSize;
  orientation: ImageOrientation;
  /** Margin in points. */
  margin: number;
  /** JPEG quality 1-100. */
  quality: number;
  /** A name typed by the user; otherwise the source names are used. */
  outputName?: string;
  onConflict?: 'keep' | 'overwrite';
}

export interface MergeOptions {
  /** Recompresses images in the merged output to reduce file size. */
  optimize: boolean;
  outputName?: string;
  /** One optional page-range expression per input, aligned with the paths. */
  pageRanges?: string[];
  onConflict?: 'keep' | 'overwrite';
}

export type SplitMode = 'ranges' | 'size' | 'extract' | 'every' | 'bookmarks';

export interface SplitOptions {
  mode: SplitMode;
  rangeText: string;
  /** Max size per part, in MB (for "size" mode). */
  maxSizeMb: number;
  selectedPages: number[];
  /** Pages per part (for "every" mode). */
  everyPages?: number;
  outputName?: string;
  onConflict?: 'keep' | 'overwrite';
}

export type CompressLevel = 'minimal' | 'light' | 'balanced' | 'strong' | 'extreme';

export interface CompressOptions {
  level: CompressLevel;
  grayscale: boolean;
  removeMetadata: boolean;
  onConflict?: 'keep' | 'overwrite';
}

/** Approximate compressed size of one file, from a quick sample of its images. */
export interface CompressEstimate {
  path: string;
  original: number;
  estimated: number;
}

export type EncryptionStrength = 'aes256' | 'aes128' | 'rc4';

export interface SecurityOptions {
  userPassword: string;
  ownerPassword?: string;
  strength: EncryptionStrength;
  onConflict?: 'keep' | 'overwrite';
}

export interface PdfMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
}

export type ExtractImageFormat = 'png' | 'jpg';

export interface PageOp {
  /** 1-based page index in the source document. */
  source: number;
  /** Added rotation in degrees (0/90/180/270). */
  rotate: number;
}

export type WatermarkPlacement = 'diagonal' | 'horizontal';
export type PageNumberPlacement = 'corner' | 'centre';

/** Decorations applied to every page when an organised PDF is saved. */
export interface OrganizeOptions {
  watermarkText: string;
  /** 0–1. */
  watermarkOpacity: number;
  watermarkPlacement: WatermarkPlacement;
  pageNumbers: boolean;
  pageNumberPlacement: PageNumberPlacement;
  pageNumberStart: number;
  headerText: string;
  footerText: string;
  /** Points cut from every edge; 0 keeps the page as it is. */
  cropMargin: number;
  onConflict?: 'keep' | 'overwrite';
}

export function emptyOrganizeOptions(): OrganizeOptions {
  return {
    watermarkText: '',
    watermarkOpacity: 0.18,
    watermarkPlacement: 'diagonal',
    pageNumbers: false,
    pageNumberPlacement: 'corner',
    pageNumberStart: 1,
    headerText: '',
    footerText: '',
    cropMargin: 0,
  };
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  releaseUrl?: string;
  releaseNotes?: string;
}
