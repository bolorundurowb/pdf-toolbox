export interface NavItem {
  label: string;
  icon: string;
  route: string;
}

export interface NavGroup {
  /** Shown as a small label above the group; omitted for the dashboard. */
  label?: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ label: 'Dashboard', icon: 'dashboard', route: '/dashboard' }],
  },
  {
    label: 'Create',
    items: [
      { label: 'Image to PDF', icon: 'image', route: '/images' },
      { label: 'Merge', icon: 'call_merge', route: '/merge' },
    ],
  },
  {
    label: 'Edit pages',
    items: [
      { label: 'Organise', icon: 'reorder', route: '/organize' },
      { label: 'Extract', icon: 'article', route: '/extract' },
    ],
  },
  {
    label: 'Convert',
    items: [{ label: 'Convert', icon: 'transform', route: '/convert' }],
  },
  {
    label: 'Optimise and protect',
    items: [
      { label: 'Compress', icon: 'compress', route: '/compress' },
      { label: 'Security', icon: 'security', route: '/security' },
    ],
  },
  {
    label: 'Properties',
    items: [{ label: 'Metadata', icon: 'info', route: '/metadata' }],
  },
];

export const SETTINGS_ITEM: NavItem = { label: 'Settings', icon: 'settings', route: '/settings' };

/** Flat list, for places that just need every tool. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);
