import {
  Clock,
  Loader,
  CheckCircle,
  XCircle,
  Ban,
  type LucideIcon,
} from 'lucide-react';
import type { MissionStatus } from '@/lib/api';

/**
 * Unified icon mapping for mission statuses.
 * Consolidates duplicate statusIcons definitions across the codebase.
 */
export const STATUS_ICONS: Record<string, LucideIcon> = {
  pending: Clock,
  active: Loader,
  running: Loader,
  completed: CheckCircle,
  failed: XCircle,
  cancelled: Ban,
  interrupted: Ban,
  blocked: Ban,
  not_feasible: XCircle,
};

/**
 * Get the icon component for a mission status.
 * @param status - The mission status
 * @param fallback - Fallback icon (default: Clock)
 */
export function getStatusIcon(status: MissionStatus | string, fallback: LucideIcon = Clock): LucideIcon {
  return STATUS_ICONS[status] || fallback;
}
