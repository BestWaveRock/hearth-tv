import { useState } from 'react';
import type { Entry } from '../../shared/types';
import { useFocusable } from '../focus';
import { formatTime, hueFrom } from '../lib/format';
import { useT } from '../lib/i18n';
import { cx } from './primitives';

const GLYPHS: Record<string, string> = {
  folder: '▤',
  video: '▶',
  track: '♪',
  album: '◉',
  artist: '☻',
  playlist: '≡',
  image: '▣',
  other: '·',
};

export type TileShape = 'poster' | 'square' | 'video' | 'wide';

interface TileProps {
  entry: Entry;
  shape?: TileShape;
  /** 0–1 resume position, drawn as a bar across the artwork. */
  progress?: number;
  badge?: string;
  subtitle?: string | null;
  onSelect: () => void;
  onLongSelect?: () => void;
  onFocus?: () => void;
  priority?: number;
}

/**
 * A poster tile.
 *
 * Artwork is optional by design: most WebDAV libraries have none, so the
 * fallback has to look intentional rather than broken. It derives a stable warm
 * hue from the title, which makes a wall of folders read as a palette instead
 * of as a wall of grey boxes.
 */
export function Tile({
  entry,
  shape = 'poster',
  progress,
  badge,
  subtitle,
  onSelect,
  onLongSelect,
  onFocus,
  priority,
}: TileProps) {
  const f = useFocusable<HTMLButtonElement>({ onSelect, onLongSelect, onFocus, priority });
  const t = useT();
  const [artFailed, setArtFailed] = useState(false);

  const hue = hueFrom(entry.title || entry.name);
  const showArt = Boolean(entry.art) && !artFailed;
  const glyph = GLYPHS[entry.kind] ?? GLYPHS.other;
  const isPlayable = entry.kind === 'video' || entry.kind === 'track';

  return (
    <button
      ref={f.ref}
      className={cx('focusable tile', shape !== 'poster' && `tile--${shape}`)}
      {...f.props}
    >
      <span
        className="tile__art"
        style={
          showArt
            ? undefined
            : {
                background: `linear-gradient(155deg,
                  hsl(${hue} 62% 26% / 0.92),
                  hsl(${hue - 26} 48% 13% / 0.95))`,
              }
        }
      >
        {showArt ? (
          <img
            src={entry.art ?? ''}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setArtFailed(true)}
          />
        ) : (
          <span className="tile__glyph" aria-hidden="true">
            {glyph}
          </span>
        )}

        {badge ? <span className="tile__badge">{badge}</span> : null}

        {isPlayable ? (
          <span className="tile__play" aria-hidden="true">
            <span>▶</span>
          </span>
        ) : null}

        {progress !== undefined && progress > 0.01 && progress < 0.98 ? (
          <span className="tile__progress">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
        ) : null}
      </span>

      <span className="tile__meta">
        <span className="tile__title clamp-2">{entry.title || entry.name}</span>
        {subtitle !== null ? (
          <span className="tile__sub clamp-1">
            {subtitle ?? entry.subtitle ?? secondaryLine(entry, t('tile.folder'))}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function secondaryLine(entry: Entry, folderLabel: string): string {
  if (entry.artist) return entry.artist;
  if (entry.year) return String(entry.year);
  if (entry.duration) return formatTime(entry.duration);
  if (entry.kind === 'folder') return folderLabel;
  return entry.ext ? entry.ext.toUpperCase() : '';
}
