'use client';

import { useEffect } from 'react';
import { useThemeStore } from '@/stores/theme-store';
import { SettingsSection } from './settings-section';
import { cn } from '@/lib/utils';
import { Check, Palette, Lock } from 'lucide-react';
import { toast } from '@/stores/toast-store';
import { usePolicyStore } from '@/stores/policy-store';

export function ThemesSettings() {
  const { installedThemes, activeThemeId, activateTheme } = useThemeStore();
  const { isThemeDisabled, getThemePolicy, getForcedThemeId, isThemeForceEnabled } = usePolicyStore();
  const themePolicy = getThemePolicy();
  const forcedThemeId = getForcedThemeId(installedThemes.map((theme) => theme.id));

  // Filter out themes disabled by admin policy
  const visibleThemes = installedThemes.filter(
    theme => !isThemeDisabled(theme.id, !!theme.builtIn)
  );

  useEffect(() => {
    if (forcedThemeId && activeThemeId !== forcedThemeId) {
      activateTheme(forcedThemeId);
    }
  }, [activeThemeId, activateTheme, forcedThemeId]);

  // If the active theme was disabled by admin, fall back to default
  useEffect(() => {
    if (activeThemeId) {
      const activeTheme = installedThemes.find(t => t.id === activeThemeId);
      if (activeTheme && isThemeDisabled(activeThemeId, !!activeTheme.builtIn)) {
        activateTheme(forcedThemeId ?? null);
      }
    }
  }, [activeThemeId, activateTheme, forcedThemeId, installedThemes, isThemeDisabled]);

  const handleActivate = (id: string | null) => {
    if (forcedThemeId && id !== forcedThemeId) {
      const forcedTheme = installedThemes.find((theme) => theme.id === forcedThemeId);
      toast.info(`Theme "${forcedTheme?.name ?? 'Admin theme'}" is forced by admin and cannot be changed`);
      return;
    }

    activateTheme(id);
    toast.success(id ? 'Theme activated' : 'Default theme restored');
  };

  return (
    <SettingsSection title="Themes" description="Choose from themes deployed by your administrator and built-in presets.">

      {forcedThemeId && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          Theme selection is locked by an administrator.
        </div>
      )}

      {/* Theme Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {/* Default theme card */}
        <ThemeCard
          name="Default"
          author="Bulwark"
          isActive={activeThemeId === null}
          isBuiltIn
          isDefault={!themePolicy.defaultThemeId}
          disabled={Boolean(forcedThemeId)}
          onActivate={() => handleActivate(null)}
        />

        {/* Installed themes */}
        {visibleThemes.map(theme => {
          const isForceEnabled = theme.id === forcedThemeId || theme.forceEnabled || isThemeForceEnabled(theme.id);
          return (
            <ThemeCard
              key={theme.id}
              name={theme.name}
              author={theme.author}
              preview={theme.preview}
              isActive={activeThemeId === theme.id}
              isBuiltIn={theme.builtIn}
              isDefault={themePolicy.defaultThemeId === theme.id}
              isForceEnabled={isForceEnabled}
              disabled={Boolean(forcedThemeId) && !isForceEnabled}
              variants={theme.variants}
              onActivate={() => handleActivate(theme.id)}
            />
          );
        })}
      </div>
    </SettingsSection>
  );
}

// ─── Theme Card ──────────────────────────────────────────────

interface ThemeCardProps {
  name: string;
  author: string;
  preview?: string;
  isActive: boolean;
  isBuiltIn: boolean;
  isDefault?: boolean;
  isForceEnabled?: boolean;
  disabled?: boolean;
  variants?: ('light' | 'dark')[];
  onActivate: () => void;
}

function ThemeCard({ name, author, preview, isActive, isDefault, isForceEnabled, disabled, variants, onActivate }: ThemeCardProps) {
  return (
    <div data-search-label={name} className="relative">
      <button
        type="button"
        onClick={onActivate}
        disabled={disabled}
        className={cn(
          'flex flex-col items-center p-3 rounded-xl border-2 transition-all text-left w-full disabled:cursor-not-allowed disabled:opacity-60',
          isActive
            ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
            : 'border-border hover:border-primary/40 bg-card',
          disabled && !isActive && 'hover:border-border'
        )}
      >
        {/* Preview / Placeholder */}
        <div className="w-full aspect-[16/10] rounded-lg mb-2 overflow-hidden bg-muted flex items-center justify-center">
          {preview ? (
            <img src={preview} alt={name} className="w-full h-full object-cover" />
          ) : (
            <Palette className="w-8 h-8 text-muted-foreground/40" />
          )}
        </div>

        {/* Info */}
        <div className="w-full">
          <div className="flex items-center justify-between gap-1">
            <span className="text-sm font-medium text-foreground truncate">{name}</span>
            <div className="flex items-center gap-1 flex-shrink-0">
              {isForceEnabled && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium flex items-center gap-0.5" title="Admin enforced">
                  <Lock className="w-2.5 h-2.5" />
                </span>
              )}
              {isDefault && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">Default</span>
              )}
              {isActive && <Check className="w-4 h-4 text-primary" />}
            </div>
          </div>
          <span className="text-xs text-muted-foreground truncate block">{author}</span>
          {variants && (
            <div className="flex gap-1 mt-1">
              {variants.map(v => (
                <span key={v} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {v}
                </span>
              ))}
            </div>
          )}
        </div>
      </button>
    </div>
  );
}
