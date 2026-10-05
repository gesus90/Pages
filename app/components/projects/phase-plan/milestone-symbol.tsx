import {
  Award,
  Bell,
  Bookmark,
  Briefcase,
  Bug,
  Calendar,
  CircleCheck,
  ClipboardList,
  Cog,
  Cpu,
  Database,
  Diamond,
  FileText,
  Flag,
  FlaskConical,
  Folder,
  Globe,
  Heart,
  KeyRound,
  Layers,
  Lightbulb,
  Link2,
  Lock,
  Megaphone,
  MessageSquare,
  Monitor,
  Package,
  Palette,
  PenTool,
  Puzzle,
  Rocket,
  Search,
  Server,
  Shield,
  Sparkles,
  Star,
  Target,
  Users,
  Wrench,
  Zap,
} from "lucide-react";

import { COLOR_DEFAULT_ICON } from "@/app/lib/phase-plan/plan-milestones";
import { MILESTONE_ICON } from "@/definition/Task";

import type { MilestoneColor, MilestoneIcon } from "@/definition/Task";
import type { LucideIcon } from "lucide-react";

/** The picker offers the symbols in this order. */
export const SYMBOL_OPTIONS: readonly MilestoneIcon[] =
  Object.values(MILESTONE_ICON);

const SYMBOL_COMPONENTS: Readonly<Record<MilestoneIcon, LucideIcon>> = {
  [MILESTONE_ICON.DIAMOND]: Diamond,
  [MILESTONE_ICON.ROCKET]: Rocket,
  [MILESTONE_ICON.FLAG]: Flag,
  [MILESTONE_ICON.TARGET]: Target,
  [MILESTONE_ICON.SPARKLES]: Sparkles,
  [MILESTONE_ICON.CALENDAR]: Calendar,
  [MILESTONE_ICON.PACKAGE]: Package,
  [MILESTONE_ICON.COG]: Cog,
  [MILESTONE_ICON.USERS]: Users,
  [MILESTONE_ICON.LINK]: Link2,
  [MILESTONE_ICON.MEGAPHONE]: Megaphone,
  [MILESTONE_ICON.SHIELD]: Shield,
  [MILESTONE_ICON.BELL]: Bell,
  [MILESTONE_ICON.BUG]: Bug,
  [MILESTONE_ICON.FLASK]: FlaskConical,
  [MILESTONE_ICON.STAR]: Star,
  [MILESTONE_ICON.CHECK]: CircleCheck,
  [MILESTONE_ICON.BOOKMARK]: Bookmark,
  [MILESTONE_ICON.CLIPBOARD]: ClipboardList,
  [MILESTONE_ICON.WRENCH]: Wrench,
  [MILESTONE_ICON.LAYERS]: Layers,
  [MILESTONE_ICON.GLOBE]: Globe,
  [MILESTONE_ICON.LIGHTBULB]: Lightbulb,
  [MILESTONE_ICON.MONITOR]: Monitor,
  [MILESTONE_ICON.SERVER]: Server,
  [MILESTONE_ICON.FOLDER]: Folder,
  [MILESTONE_ICON.BRIEFCASE]: Briefcase,
  [MILESTONE_ICON.PEN]: PenTool,
  [MILESTONE_ICON.PALETTE]: Palette,
  [MILESTONE_ICON.ZAP]: Zap,
  [MILESTONE_ICON.HEART]: Heart,
  [MILESTONE_ICON.AWARD]: Award,
  [MILESTONE_ICON.PUZZLE]: Puzzle,
  [MILESTONE_ICON.SEARCH]: Search,
  [MILESTONE_ICON.LOCK]: Lock,
  [MILESTONE_ICON.KEY]: KeyRound,
  [MILESTONE_ICON.CPU]: Cpu,
  [MILESTONE_ICON.DATABASE]: Database,
  [MILESTONE_ICON.MESSAGE]: MessageSquare,
  [MILESTONE_ICON.FILE]: FileText,
};

interface MilestoneSymbolProps {
  readonly icon: MilestoneIcon;
  readonly className?: string;
}

/** Renders one selectable milestone symbol. */
export function MilestoneSymbol({
  icon,
  className = "size-4 shrink-0",
}: MilestoneSymbolProps): React.ReactElement {
  const SymbolComponent = SYMBOL_COMPONENTS[icon];

  return <SymbolComponent className={className} aria-hidden="true" />;
}

interface MilestoneMarkerIconProps {
  readonly icon: MilestoneIcon | null;
  readonly color: MilestoneColor;
  readonly className?: string;
}

/** Renders the chosen milestone symbol, falling back to the color default. */
export function MilestoneMarkerIcon({
  icon,
  color,
  className,
}: MilestoneMarkerIconProps): React.ReactElement {
  return (
    <MilestoneSymbol
      icon={icon ?? COLOR_DEFAULT_ICON[color]}
      className={className}
    />
  );
}
