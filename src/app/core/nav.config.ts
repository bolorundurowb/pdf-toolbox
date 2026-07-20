export interface NavItem {
  label: string;
  icon: string;
  route: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', icon: 'dashboard', route: '/dashboard' },
  { label: 'Image to PDF', icon: 'image', route: '/images' },
  { label: 'Merge/Split', icon: 'call_merge', route: '/merge-split' },
  { label: 'Organise', icon: 'reorder', route: '/organize' },
  { label: 'Compress', icon: 'compress', route: '/compress' },
  { label: 'Extract', icon: 'article', route: '/extract' },
  { label: 'Security', icon: 'security', route: '/security' },
  { label: 'Metadata', icon: 'info', route: '/metadata' },
];
