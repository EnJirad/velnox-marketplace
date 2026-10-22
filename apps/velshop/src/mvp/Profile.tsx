/**
 * `/profile` — the original account hub.
 *
 * The photo is uploaded STRAIGHT to R2 through the server's presigned PUT, then
 * confirmed; `users.avatar_url` is the only value the page renders. Editing the
 * name/phone is a PATCH on the caller's own row (no user id is ever sent).
 */
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { getMvpApi } from "@velnox/shared/mvp";
import { MvpLoading, formatDate, toMvpError, useMvpQuery } from "@velnox/shared/mvp/ui";
import {
  Camera,
  ChevronRight,
  Heart,
  Loader2,
  LogOut,
  MapPin,
  Package,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { mvpSignOut } from "@velnox/shared/mvp/ui";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

export default function Profile() {
  const { t } = useLanguage();
  const profile = useMvpQuery(() => getMvpApi().profile.get(), []);
  const [avatarUrl, setAvatarUrl] = useState<string | null | undefined>(undefined);
  const [coverUrl, setCoverUrl] = useState<string | null | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  if (profile.loading) return <MvpLoading label={t("common.loading")} />;
  if (profile.error || !profile.data) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
        {profile.error?.message ?? t("profile.notSignedIn")}
      </div>
    );
  }

  const data = profile.data;
  const shownAvatar = avatarUrl === undefined ? data.avatarUrl : avatarUrl;
  const shownCover = coverUrl === undefined ? data.coverUrl : coverUrl;
  const shownName = name ?? data.name;
  const shownPhone = phone ?? data.phone ?? "";

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      toast.error(t("profile.imageTypeError"));
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t("profile.imageSizeError"));
      return;
    }
    setUploading(true);
    try {
      const signed = await getMvpApi().profile.presignAvatar({
        contentType: file.type,
        size: file.size,
      });
      const put = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error(t("profile.imageUploadFailed"));
      const confirmed = await getMvpApi().profile.confirmAvatar(signed.objectKey);
      setAvatarUrl(confirmed.avatarUrl);
      toast.success(t("profile.avatarUpdated"));
    } catch (error) {
      toast.error(toMvpError(error).message || t("profile.imageUploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const uploadCover = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      toast.error(t("profile.imageTypeError"));
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t("profile.imageSizeError"));
      return;
    }
    setUploadingCover(true);
    try {
      const signed = await getMvpApi().profile.presignCover({
        contentType: file.type,
        size: file.size,
      });
      const put = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error(t("profile.imageUploadFailed"));
      const confirmed = await getMvpApi().profile.confirmCover(signed.objectKey);
      setCoverUrl(confirmed.coverUrl);
      toast.success(t("profile.coverUpdated"));
    } catch (error) {
      toast.error(toMvpError(error).message || t("profile.imageUploadFailed"));
    } finally {
      setUploadingCover(false);
    }
  };

  const removeCover = async () => {
    setUploadingCover(true);
    try {
      await getMvpApi().profile.removeCover();
      setCoverUrl(null);
      toast.success(t("profile.coverUpdated"));
    } catch (error) {
      toast.error(toMvpError(error).message);
    } finally {
      setUploadingCover(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const updated = await getMvpApi().profile.update({ name: shownName, phone: shownPhone });
      setName(updated.name);
      setPhone(updated.phone ?? "");
      toast.success(t("common.save"));
    } catch (error) {
      toast.error(toMvpError(error).message);
    } finally {
      setSaving(false);
    }
  };

  const removeAvatar = async () => {
    setUploading(true);
    try {
      await getMvpApi().profile.removeAvatar();
      setAvatarUrl(null);
      toast.success(t("profile.avatarUpdated"));
    } catch (error) {
      toast.error(toMvpError(error).message);
    } finally {
      setUploading(false);
    }
  };

  const initials = (shownName || data.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <div className="grid gap-5">
      <div>
        <p className="text-sm font-medium text-slate-400">{t("profile.eyebrow")}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {t("profile.title")}
        </h1>
      </div>

      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-emerald-50 via-slate-50 to-slate-100">
        <div className="h-32 w-full sm:h-40">
          {shownCover ? (
            <img
              src={shownCover}
              alt={t("profile.coverAlt", { name: shownName })}
              className="size-full object-cover"
            />
          ) : null}
        </div>
        <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => coverInput.current?.click()}
            disabled={uploadingCover}
            className="flex h-8 items-center gap-1.5 rounded-[10px] border border-slate-200 bg-white/95 px-2.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-white"
          >
            {uploadingCover ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Camera className="size-3.5" />
            )}
            {t("profile.changeCover")}
          </button>
          {shownCover && (
            <button
              type="button"
              onClick={() => void removeCover()}
              disabled={uploadingCover}
              className="flex size-8 items-center justify-center rounded-[10px] border border-slate-200 bg-white/95 text-slate-400 shadow-sm transition-colors hover:text-rose-500"
              aria-label={t("common.remove")}
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
          <input
            ref={coverInput}
            type="file"
            accept={ACCEPTED.join(",")}
            className="hidden"
            onChange={(event) => void uploadCover(event)}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative">
            <span className="flex size-20 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-900 text-xl font-bold text-white">
              {shownAvatar ? (
                <img src={shownAvatar} alt={t("profile.avatarAlt", { name: shownName })} className="size-full object-cover" />
              ) : (
                initials
              )}
            </span>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 flex size-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
              aria-label={t("profile.changeAvatar")}
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Camera className="size-4" />
              )}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED.join(",")}
              className="hidden"
              onChange={(event) => void upload(event)}
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-lg font-bold text-slate-900">
              {shownName || data.email}
              {data.role !== "customer" && (
                <ShieldCheck className="size-4 text-[#10B981]" aria-label={data.role} />
              )}
            </p>
            <p className="truncate text-sm text-slate-500">{data.email}</p>
            <p className="mt-1 text-xs text-slate-400">
              {t("profile.memberSince", { date: formatDate(data.createdAt) })}
            </p>
            {shownAvatar && (
              <button
                type="button"
                onClick={() => void removeAvatar()}
                disabled={uploading}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-400 transition-colors hover:text-rose-500"
              >
                <Trash2 className="size-3" />
                {t("common.remove")}
              </button>
            )}
          </div>
        </div>

        <form onSubmit={save} className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="profile-name" className="text-xs font-medium text-slate-500">
              {t("account.name")}
            </Label>
            <Input
              id="profile-name"
              value={shownName}
              onChange={(event) => setName(event.target.value)}
              className="h-11 rounded-[10px] border-slate-200"
              disabled={saving}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="profile-phone" className="text-xs font-medium text-slate-500">
              {t("account.phone")}
            </Label>
            <Input
              id="profile-phone"
              type="tel"
              value={shownPhone}
              onChange={(event) => setPhone(event.target.value)}
              className="h-11 rounded-[10px] border-slate-200"
              disabled={saving}
            />
          </div>
          <div className="sm:col-span-2">
            <Button
              type="submit"
              className="h-10 gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
              disabled={saving}
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t("common.save")}
            </Button>
          </div>
        </form>
      </section>

      <section className="grid gap-2 sm:grid-cols-2">
        <ProfileLink to="/orders" icon={Package} title={t("profile.orders")} desc={t("profile.ordersDesc")} />
        <ProfileLink to="/wishlist" icon={Heart} title={t("profile.wishlist")} desc={t("profile.wishlistDesc")} />
        <ProfileLink to="/addresses" icon={MapPin} title={t("profile.addresses")} desc={t("profile.addressesDesc")} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">{t("profile.session")}</p>
            <p className="text-xs text-slate-500">{t("profile.accountNote")}</p>
          </div>
          <Button
            variant="outline"
            className="h-9 gap-1.5 border-slate-200 text-slate-700"
            onClick={async () => {
              await mvpSignOut();
              window.location.assign("/");
            }}
          >
            <LogOut className="size-4" />
            {t("profile.signOut")}
          </Button>
        </div>
      </section>
    </div>
  );
}

function ProfileLink({
  to,
  icon: Icon,
  title,
  desc,
}: {
  to: string;
  icon: typeof UserRound;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
        <Icon className="size-5 text-[#10B981]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="block truncate text-xs text-slate-500">{desc}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-slate-400" />
    </Link>
  );
}
