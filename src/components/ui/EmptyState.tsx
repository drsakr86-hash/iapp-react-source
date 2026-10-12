import { Icon, type IconName } from './Icon';

/** Call sites may still pass a legacy emoji; it is shown as the matching SVG. */
const FROM_EMOJI: Record<string, IconName> = {
  '⚠️': 'alert',
  '🩺': 'stethoscope',
  '🔍': 'search',
  '🏥': 'building',
  '🧾': 'receipt',
  '💳': 'credit-card',
  '🏦': 'landmark',
  '📊': 'bar-chart',
  '🔒': 'lock',
  '↩️': 'undo',
  '📒': 'receipt',
  '💰': 'wallet',
  '🔁': 'repeat',
  '💊': 'pill',
  '📋': 'clipboard',
};

interface EmptyStateProps {
  icon?: string;
  text: string;
}

export function EmptyState({ icon, text }: EmptyStateProps) {
  const name = icon ? FROM_EMOJI[icon] : undefined;
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{name ? <Icon name={name} size={36} /> : icon}</div>}
      <div className="empty-state__text">{text}</div>
    </div>
  );
}
