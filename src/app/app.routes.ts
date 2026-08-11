import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'images',
    loadComponent: () => import('./pages/images/images.component').then((m) => m.ImagesComponent),
  },
  {
    path: 'merge',
    loadComponent: () => import('./pages/merge/merge.component').then((m) => m.MergeComponent),
  },
  // Splitting moved to Extract; keep old deep links working.
  { path: 'merge-split', redirectTo: 'merge' },
  {
    path: 'compress',
    loadComponent: () => import('./pages/compress/compress.component').then((m) => m.CompressComponent),
  },
  {
    path: 'security',
    loadComponent: () => import('./pages/security/security.component').then((m) => m.SecurityComponent),
  },
  {
    path: 'metadata',
    loadComponent: () => import('./pages/metadata/metadata.component').then((m) => m.MetadataComponent),
  },
  {
    path: 'organize',
    loadComponent: () => import('./pages/organize/organize.component').then((m) => m.OrganizeComponent),
  },
  {
    path: 'extract',
    loadComponent: () => import('./pages/extract/extract.component').then((m) => m.ExtractComponent),
  },
  { path: '**', redirectTo: 'dashboard' },
];
