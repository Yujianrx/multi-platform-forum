import { forwardRef } from 'react';
import type { LucideProps } from 'lucide-react';
import { brandAssets } from './brand-assets';

// AI artwork is displayed through a clipped SVG viewport. The actual controls
// retain their labels, focus behavior and handlers; each atlas is cached once.
function atlasIcon(
  name: string,
  atlas: keyof typeof brandAssets.atlases,
  index: number,
  columns: number,
) {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(
    (
      {
        size = 24,
        className = '',
        color: _color,
        strokeWidth: _strokeWidth,
        absoluteStrokeWidth: _absoluteStrokeWidth,
        children,
        ...props
      },
      ref,
    ) => (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox={`${(index % columns) * 100} ${Math.floor(index / columns) * 100} 100 100`}
        fill="none"
        className={`lucide ai-icon ${className}`}
        data-ai-icon={name}
        aria-hidden={props['aria-label'] ? undefined : true}
        focusable="false"
        {...props}
        style={{ overflow: 'hidden', ...props.style }}
      >
        <image
          href={brandAssets.atlases[atlas]}
          width={columns * 100}
          height={400}
          preserveAspectRatio="xMidYMid meet"
        />
        {children}
      </svg>
    ),
  );
  Icon.displayName = name;
  return Icon;
}
export const BriefcaseBusiness = atlasIcon('BriefcaseBusiness', 'community', 0, 4);
export const Lightbulb = atlasIcon('Lightbulb', 'community', 1, 4);
export const ChartNoAxesCombined = atlasIcon('ChartNoAxesCombined', 'community', 2, 4);
export const Code2 = atlasIcon('Code2', 'community', 3, 4);
export const Palette = atlasIcon('Palette', 'community', 4, 4);
export const Sparkles = atlasIcon('Sparkles', 'community', 5, 4);
export const Package = atlasIcon('Package', 'community', 6, 4);
export const Quote = atlasIcon('Quote', 'community', 7, 4);
export const MessageCircle = atlasIcon('MessageCircle', 'community', 8, 4);
export const Flame = atlasIcon('Flame', 'community', 9, 4);
export const Heart = atlasIcon('Heart', 'community', 10, 4);
export const Bookmark = atlasIcon('Bookmark', 'community', 11, 4);
export const Plus = atlasIcon('Plus', 'community', 12, 4);
export const Bell = atlasIcon('Bell', 'community', 13, 4);
export const Search = atlasIcon('Search', 'community', 14, 4);
export const Home = atlasIcon('Home', 'community', 15, 4);
export const Bold = atlasIcon('Bold', 'editor', 0, 4);
export const Italic = atlasIcon('Italic', 'editor', 1, 4);
export const Underline = atlasIcon('Underline', 'editor', 2, 4);
export const Strikethrough = atlasIcon('Strikethrough', 'editor', 3, 4);
export const List = atlasIcon('List', 'editor', 4, 4);
export const ListOrdered = atlasIcon('ListOrdered', 'editor', 5, 4);
export const ListChecks = atlasIcon('ListChecks', 'editor', 6, 4);
export const Table2 = atlasIcon('Table2', 'editor', 7, 4);
export const Link2 = atlasIcon('Link2', 'editor', 8, 4);
export const Unlink = atlasIcon('Unlink', 'editor', 9, 4);
export const Image = atlasIcon('Image', 'editor', 10, 4);
export const Smile = atlasIcon('Smile', 'editor', 11, 4);
export const Paperclip = atlasIcon('Paperclip', 'editor', 12, 4);
export const Undo2 = atlasIcon('Undo2', 'editor', 13, 4);
export const Redo2 = atlasIcon('Redo2', 'editor', 14, 4);
export const RemoveFormatting = atlasIcon('RemoveFormatting', 'editor', 15, 4);
export const ArrowLeft = atlasIcon('ArrowLeft', 'actions', 0, 5);
export const ArrowRight = atlasIcon('ArrowRight', 'actions', 1, 5);
export const ArrowUpRight = atlasIcon('ArrowUpRight', 'actions', 2, 5);
export const ChevronDown = atlasIcon('ChevronDown', 'actions', 3, 5);
export const Play = atlasIcon('Play', 'actions', 4, 5);
export const Pause = atlasIcon('Pause', 'actions', 5, 5);
export const X = atlasIcon('X', 'actions', 6, 5);
export const Check = atlasIcon('Check', 'actions', 7, 5);
export const Download = atlasIcon('Download', 'actions', 8, 5);
export const UploadCloud = atlasIcon('UploadCloud', 'actions', 9, 5);
export const Pencil = atlasIcon('Pencil', 'actions', 10, 5);
export const Trash2 = atlasIcon('Trash2', 'actions', 11, 5);
export const Copy = atlasIcon('Copy', 'actions', 12, 5);
export const Eye = atlasIcon('Eye', 'actions', 13, 5);
export const Maximize2 = atlasIcon('Maximize2', 'actions', 14, 5);
export const Minimize2 = atlasIcon('Minimize2', 'actions', 15, 5);
export const MoreHorizontal = atlasIcon('MoreHorizontal', 'actions', 16, 5);
export const Save = atlasIcon('Save', 'actions', 17, 5);
export const Send = atlasIcon('Send', 'actions', 18, 5);
export const LogOut = atlasIcon('LogOut', 'actions', 19, 5);
export const UserRound = atlasIcon('UserRound', 'admin', 0, 5);
export const Users = atlasIcon('Users', 'admin', 1, 5);
export const ShieldCheck = atlasIcon('ShieldCheck', 'admin', 2, 5);
export const Settings = atlasIcon('Settings', 'admin', 3, 5);
export const SlidersHorizontal = atlasIcon('SlidersHorizontal', 'admin', 4, 5);
export const LockKeyhole = atlasIcon('LockKeyhole', 'admin', 5, 5);
export const Flag = atlasIcon('Flag', 'admin', 6, 5);
export const Pin = atlasIcon('Pin', 'admin', 7, 5);
export const Clock = atlasIcon('Clock', 'admin', 8, 5);
export const FileText = atlasIcon('FileText', 'admin', 9, 5);
export const BookOpen = atlasIcon('BookOpen', 'admin', 10, 5);
export const Layers = atlasIcon('Layers', 'admin', 11, 5);
export const HardDrive = atlasIcon('HardDrive', 'admin', 12, 5);
export const Ticket = atlasIcon('Ticket', 'admin', 13, 5);
export const RefreshCw = atlasIcon('RefreshCw', 'admin', 14, 5);
export const AlertCircle = atlasIcon('AlertCircle', 'admin', 15, 5);
export const Camera = atlasIcon('Camera', 'admin', 16, 5);
export const Compass = atlasIcon('Compass', 'admin', 17, 5);
export const LayoutDashboard = atlasIcon('LayoutDashboard', 'admin', 18, 5);
export const SearchX = atlasIcon('SearchX', 'admin', 19, 5);
export {
  MessageCircle as MessageSquare,
  FileText as File,
  FileText as ScrollText,
  Image as ImagePlus,
  Pencil as Edit3,
  ArrowLeft as ChevronLeft,
  ArrowRight as ChevronRight,
  ArrowUpRight as ExternalLink,
  Check as CheckCircle2,
  Check as CheckCheck,
};
