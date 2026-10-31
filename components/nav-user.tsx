"use client";

import { useEffect, useRef, useState } from "react";
import {
  KeyRound,
  Loader2,
  LogOut,
  Power,
  Camera,
  Pencil,
  RotateCcw,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { logout } from "@/hooks/use-auth";
import { useModemReconnect } from "@/hooks/use-modem-reconnect";
import { authFetch } from "@/lib/auth-fetch";
import { rebootNow } from "@/lib/reboot";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { ChangePasswordDialog } from "@/components/auth/change-password-dialog";
import { useTranslation } from "react-i18next";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { useMotionPreference } from "@/components/motion-preference";
import {
  MOTION_PREFERENCES,
  type MotionPreference,
} from "@/lib/motion-preference";

// Animations preference, presented beside the theme row: both are appearance
// choices that live on this device only, so they belong in the same group.
//
// The keys are written out as LITERALS rather than built with
// t(`motion.${preference}`). lib/i18n/check.ts scans source text for key
// stems, and an interpolated key is invisible to it — a missing translation
// would then ship as the raw key string with a green check run.
const MOTION_LABEL_KEY: Record<MotionPreference, string> = {
  system: "motion.system",
  full: "motion.full",
  reduced: "motion.reduced",
};

// All three glyphs are already in the subset (components/ui/material-symbol-names.ts).
const MOTION_ICON: Record<MotionPreference, MaterialSymbolName> = {
  system: "settings",
  full: "auto_awesome",
  reduced: "do_not_disturb_on",
};

/** Shown until the device hostname arrives, and if it never does. */
const FALLBACK_NAME = "Admin";

export function NavUser() {
  const { isMobile } = useSidebar();
  const { t } = useTranslation("common");
  const { t: tSidebar } = useTranslation("sidebar");
  const { resolvedTheme, setTheme } = useTheme();
  const { preference: motionPreference, setPreference: setMotionPreference } =
    useMotionPreference();

  // --- Display name from device hostname ---
  const [displayName, setDisplayName] = useState<string>(FALLBACK_NAME);
  const [avatarSrc, setAvatarSrc] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("qm_display_avatar") || "";
  });

  // Fetch hostname from system settings on mount
  useEffect(() => {
    authFetch("/cgi-bin/quecmanager/system/settings.sh")
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.settings?.hostname) {
          setDisplayName(json.settings.hostname);
        }
      })
      .catch(() => {});
  }, []);

  // --- Dialog state ---
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [reconnectDialogOpen, setReconnectDialogOpen] = useState(false);
  const [rebootDialogOpen, setRebootDialogOpen] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const {
    reconnectModem,
    isReconnecting,
    step: reconnectStep,
  } = useModemReconnect();

  // --- Name edit state ---
  const [nameInput, setNameInput] = useState(displayName);

  // --- Avatar upload ---
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("account.photo_invalid"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      localStorage.setItem("qm_display_avatar", base64);
      setAvatarSrc(base64);
      toast.success(t("account.photo_updated"));
    };
    reader.readAsDataURL(file);
    // Reset so same file can be re-selected
    e.target.value = "";
  };

  // --- Name save (updates device hostname) ---
  const [savingName, setSavingName] = useState(false);

  const handleNameSave = async () => {
    const name = nameInput.trim();
    if (!name) return;
    setSavingName(true);
    try {
      const resp = await authFetch("/cgi-bin/quecmanager/system/settings.sh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_settings", hostname: name }),
      });
      const json = await resp.json();
      if (!json.success) {
        toast.error(
          resolveErrorMessage(
            t,
            json.error,
            json.detail,
            t("account.name_save_failed"),
          ),
        );
        return;
      }
      setDisplayName(name);
      setNameDialogOpen(false);
      toast.success(t("account.name_saved"));
    } catch {
      toast.error(t("account.name_save_failed"));
    } finally {
      setSavingName(false);
    }
  };

  // --- Reboot (optimistic) ---
  // Fire the reboot request, then redirect to the countdown page.
  const handleReboot = async (e: React.MouseEvent) => {
    e.preventDefault();
    setRebooting(true);
    rebootNow("manual");
  };

  const handleReconnect = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (isReconnecting) return;

    const result = await reconnectModem({
      onStep: (step) => {
        if (step === "disconnecting") {
          toast.info(t("state.disconnecting"));
          return;
        }
        toast.info(t("state.reconnecting"));
      },
    });

    if (!result.success) {
      toast.error(
        resolveErrorMessage(
          t,
          result.error,
          undefined,
          t("account.reconnect_failed"),
        ),
      );
      return;
    }

    setReconnectDialogOpen(false);
    toast.success(t("account.reconnect_complete"));
  };

  const initials =
    displayName
      .split(/[-_ ]+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "QM";

  return (
    <>
      {/* Hidden file input for avatar upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* The one filled surface in the footer. It sits on
                  surface-container-high rather than a pill outline so the
                  account block reads as a distinct object from the nav rows
                  above it, which are transparent until selected. */}
              <SidebarMenuButton
                size="lg"
                className="bg-surface-container-high hover:bg-surface-container-high/70 data-[state=open]:bg-surface-container-high h-[3.25rem] gap-3 px-2.5"
              >
                <Avatar className="size-8 rounded-pill">
                  {/* Only mount the image when there IS one. An <img src="">
                      resolves against the page URL and paints a broken-image
                      box over the fallback. */}
                  {avatarSrc ? <AvatarImage src={avatarSrc} alt="" /> : null}
                  <AvatarFallback className="bg-primary text-primary-foreground rounded-pill text-xs font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-medium">
                    {displayName}
                  </span>
                  <span className="text-sidebar-foreground/70 truncate text-xs">
                    {tSidebar("user.signed_in")}
                  </span>
                </div>
                <MaterialSymbol
                  name="unfold_more"
                  size={18}
                  className="text-sidebar-foreground/60 ml-auto"
                />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
              side={isMobile ? "bottom" : "right"}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  {/* Clickable avatar with camera overlay */}
                  <button
                    type="button"
                    onClick={handleAvatarClick}
                    className="relative group shrink-0 rounded-pill focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
                    aria-label={t("account.change_photo_aria")}
                  >
                    <Avatar className="size-8 rounded-pill">
                      {avatarSrc ? (
                        <AvatarImage src={avatarSrc} alt="" />
                      ) : null}
                      <AvatarFallback className="bg-primary text-primary-foreground rounded-pill text-xs font-semibold">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute inset-0 rounded-pill bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--duration-quick)] ease-[var(--ease-standard)]">
                      <Camera className="size-3.5 text-white" />
                    </div>
                  </button>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{displayName}</span>
                  </div>
                </div>
              </DropdownMenuLabel>

              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground text-xs">
                {t("language.label")}
              </DropdownMenuLabel>
              <div className="px-1 pb-1">
                <LanguageSwitcher />
              </div>

              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => {
                    setNameInput(displayName);
                    setNameDialogOpen(true);
                  }}
                >
                  <Pencil />
                  {t("actions.change_display_name")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPasswordDialogOpen(true)}>
                  <KeyRound />
                  {t("actions.change_password")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    setTheme(resolvedTheme === "dark" ? "light" : "dark")
                  }
                >
                  <Sun className="dark:hidden" />
                  <Moon className="hidden dark:block" />
                  {t("actions.toggle_theme")}
                </DropdownMenuItem>
                {/* Animations sits directly under Theme: the two device-local
                    appearance preferences read as one pair.

                    Three states cycle in place rather than through a submenu,
                    which keeps the theme row's interaction shape. The default
                    close is suppressed so reaching Reduced from System is one
                    open and two clicks, not two opens. The current state is
                    shown as a trailing value because a glyph alone cannot
                    distinguish "following the OS" from "explicitly Full". */}
                <DropdownMenuItem
                  onSelect={(event) => event.preventDefault()}
                  onClick={() =>
                    setMotionPreference(
                      MOTION_PREFERENCES[
                        (MOTION_PREFERENCES.indexOf(motionPreference) + 1) %
                          MOTION_PREFERENCES.length
                      ]
                    )
                  }
                >
                  <MaterialSymbol
                    name={MOTION_ICON[motionPreference]}
                    size={16}
                  />
                  {t("motion.label")}
                  <span
                    aria-live="polite"
                    className="text-muted-foreground ml-auto text-xs"
                  >
                    {t(MOTION_LABEL_KEY[motionPreference])}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setReconnectDialogOpen(true)}
                  disabled={isReconnecting}
                >
                  {isReconnecting ? (
                    <Loader2 className="size-4 motion-safe:animate-spin" />
                  ) : (
                    <RotateCcw />
                  )}
                  {t("actions.reconnect_modem")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setRebootDialogOpen(true)}
              >
                <Power />
                {t("actions.reboot_device")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => logout()}>
                <LogOut />
                {t("actions.log_out")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      {/* Change Display Name dialog */}
      <Dialog
        open={nameDialogOpen}
        onOpenChange={(open) => {
          setNameDialogOpen(open);
          if (!open) setNameInput(displayName);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("actions.change_display_name")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder={t("account.name_placeholder")}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNameSave();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNameDialogOpen(false)}>
              {t("actions.cancel")}
            </Button>
            <Button
              onClick={handleNameSave}
              disabled={
                !nameInput.trim() ||
                nameInput.trim() === displayName ||
                savingName
              }
            >
              {savingName ? (
                <>
                  <Loader2 className="size-4 motion-safe:animate-spin" />
                  {t("state.saving")}
                </>
              ) : (
                t("actions.save")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChangePasswordDialog
        open={passwordDialogOpen}
        onOpenChange={setPasswordDialogOpen}
      />

      <AlertDialog
        open={reconnectDialogOpen}
        onOpenChange={(open) => {
          if (!isReconnecting) setReconnectDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("actions.reconnect_modem")}</AlertDialogTitle>
            <AlertDialogDescription aria-live="polite">
              {isReconnecting
                ? reconnectStep === "disconnecting"
                  ? t("account.disconnecting_description")
                  : t("account.reconnecting_description")
                : t("account.reconnect_description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isReconnecting}>
              {t("actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isReconnecting}
              onClick={handleReconnect}
            >
              {isReconnecting ? (
                <>
                  <Loader2 className="size-4 motion-safe:animate-spin" />
                  {reconnectStep === "disconnecting"
                    ? t("state.disconnecting")
                    : t("state.reconnecting")}
                </>
              ) : (
                t("account.reconnect_action")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={rebootDialogOpen}
        onOpenChange={(open) => {
          if (!rebooting) setRebootDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("actions.reboot_device")}</AlertDialogTitle>
            <AlertDialogDescription aria-live="polite">
              {rebooting
                ? t("account.reboot_sent")
                : t("account.reboot_description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rebooting}>
              {t("actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={rebooting}
              onClick={handleReboot}
            >
              {rebooting ? (
                <>
                  <Loader2 className="size-4 motion-safe:animate-spin" />
                  {t("state.applying")}
                </>
              ) : (
                t("account.reboot_now")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
