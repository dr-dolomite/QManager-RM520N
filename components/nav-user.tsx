"use client";

import { useRef, useState } from "react";
import {
  ChevronsUpDown,
  KeyRound,
  Loader2,
  LogOut,
  Moon,
  Power,
  Sun,
  Camera,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { logout } from "@/hooks/use-auth";
import { authFetch } from "@/lib/auth-fetch";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
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

export function NavUser({
  user,
}: {
  user: {
    name: string;
    avatar: string;
  };
}) {
  const { isMobile } = useSidebar();
  const { theme, setTheme } = useTheme();

  // --- Local overrides (from localStorage) ---
  const [displayName, setDisplayName] = useState<string>(() => {
    if (typeof window === "undefined") return user.name;
    return localStorage.getItem("qm_display_name") || user.name;
  });
  const [avatarSrc, setAvatarSrc] = useState<string>(() => {
    if (typeof window === "undefined") return user.avatar;
    return localStorage.getItem("qm_display_avatar") || user.avatar;
  });

  // --- Dialog state ---
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [rebootDialogOpen, setRebootDialogOpen] = useState(false);
  const [rebooting, setRebooting] = useState(false);

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
      toast.error("Please select an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      localStorage.setItem("qm_display_avatar", base64);
      setAvatarSrc(base64);
      toast.success("Profile photo updated.");
    };
    reader.readAsDataURL(file);
    // Reset so same file can be re-selected
    e.target.value = "";
  };

  // --- Name save ---
  const handleNameSave = () => {
    const name = nameInput.trim();
    if (!name) return;
    localStorage.setItem("qm_display_name", name);
    setDisplayName(name);
    setNameDialogOpen(false);
    toast.success("Display name updated.");
  };

  // --- Reboot ---
  const handleReboot = async (e: React.MouseEvent) => {
    e.preventDefault();
    setRebooting(true);
    try {
      const res = await authFetch("/cgi-bin/quecmanager/system/reboot.sh", {
        method: "POST",
      });
      if (!res.ok) {
        toast.error("Reboot failed — restart the device manually");
        setRebooting(false);
        return;
      }
    } catch {
      // Connection drop is expected — device is going down
    }
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
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={avatarSrc} alt={displayName} />
                  <AvatarFallback className="rounded-lg">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{displayName}</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
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
                    className="relative group shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Change profile photo"
                  >
                    <Avatar className="h-8 w-8 rounded-lg">
                      <AvatarImage src={avatarSrc} alt={displayName} />
                      <AvatarFallback className="rounded-lg">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute inset-0 rounded-lg bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Camera className="size-3.5 text-white" />
                    </div>
                  </button>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{displayName}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => {
                    setNameInput(displayName);
                    setNameDialogOpen(true);
                  }}
                >
                  <Pencil />
                  Change Display Name
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setPasswordDialogOpen(true)}
                >
                  <KeyRound />
                  Change Password
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    setTheme(theme === "dark" ? "light" : "dark")
                  }
                >
                  <Sun className="dark:hidden" />
                  <Moon className="hidden dark:block" />
                  Toggle Theme
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setRebootDialogOpen(true)}
              >
                <Power />
                Reboot Device
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => logout()}>
                <LogOut />
                Log out
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
            <DialogTitle>Change Display Name</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Your name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNameSave();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNameDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleNameSave}
              disabled={!nameInput.trim() || nameInput.trim() === displayName}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChangePasswordDialog
        open={passwordDialogOpen}
        onOpenChange={setPasswordDialogOpen}
      />

      <AlertDialog open={rebootDialogOpen} onOpenChange={(open) => {
        if (!rebooting) setRebootDialogOpen(open);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reboot Device</AlertDialogTitle>
            <AlertDialogDescription aria-live="polite">
              {rebooting
                ? "The device is restarting and will be unreachable for about 30–60 seconds. Refresh this page once it comes back online."
                : "The device will restart and all network connections will drop until it comes back online."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rebooting}>
              Not Now
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={rebooting}
              onClick={handleReboot}
            >
              {rebooting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Rebooting...
                </>
              ) : (
                "Reboot Now"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
