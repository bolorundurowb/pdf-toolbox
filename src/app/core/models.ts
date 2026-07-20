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
}

export interface MergeOptions {
  /** Recompresses images in the merged output to reduce file size. */
  optimize: boolean;
  outputName?: string;
}

export type SplitMode = 'ranges' | 'size' | 'extract';

export interface SplitOptions {
  mode: SplitMode;
  rangeText: string;
  /** Max size per part, in MB (for "size" mode). */
  maxSizeMb: number;
  selectedPages: number[];
  outputName?: string;
}

export type CompressLevel = 'low' | 'balanced' | 'high';

export interface CompressOptions {
  level: CompressLevel;
  grayscale: boolean;
  removeMetadata: boolean;
}

export type EncryptionStrength = 'aes256' | 'aes128' | 'rc4';

export interface SecurityOptions {
  userPassword: string;
  ownerPassword?: string;
  strength: EncryptionStrength;
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
