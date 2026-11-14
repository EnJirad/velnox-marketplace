import { Logo } from "@velnox/shared/components/Logo";
// Mobile navigation removed — VelCenter uses top tab strip on all breakpoints
import { LanguageSwitcher } from "@velnox/shared/components/LanguageSwitcher";
import { UserMenu } from "@velnox/shared/components/UserMenu";
import AuditLogTab from "../components/AuditLogTab";
import PaymentIncidentTab from "../components/PaymentIncidentTab";
import { openOrderShipDialog } from "../components/OrderShipDialog";
import { emitCenterEvent, onCenterEvent } from "../lib/center-events";
// VerificationReviewDialog is now used inside SellerVerificationQueue component
import CategoriesManagement from "../components/CategoriesManagement";
import ChatManagement from "../components/ChatManagement";
import ProductModerationQueue from "../components/ProductModerationQueue";
import { MarketingBanners } from "../components/MarketingBanners";
import SellerVerificationQueue from "../components/SellerVerificationQueue";
import TrackingTab from "../components/TrackingTab";
import { VerificationStatusLabel } from "@velnox/shared/components/VerificationStatusLabel";
import ChangePasswordScreen from "../components/ChangePasswordScreen";
import EmployeeManager from "../components/EmployeeManager";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@velnox/shared/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@velnox/shared/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@velnox/shared/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@velnox/shared/components/ui/table";
import { Textarea } from "@velnox/shared/components/ui/textarea";
import { api } from "@velnox/shared/lib/api-routes";
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from "@velnox/shared/lib/i18n/config";
import { useLanguage } from "@velnox/shared/lib/i18n";
// Id type replaced with string
import { roleHoldsPermission } from "@velnox/shared/lib/api-client";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { useRealtimeState } from "@velnox/shared/hooks/use-realtime-state";
import {
  connectChatSocket,
  onAnyChatEvent,
  onChatReconnect,
  subscribeChatChannel,
} from "@velnox/shared/lib/chat-socket";
import {
  resolveCategoryMeta,
  STATUS_META,
  DAY_MS,
  effectiveCycleDays,
  formatDays,
  formatNumber,
  formatThaiDate,
  reorderInfo,
  type Product,
} from "@velnox/shared/lib/reorder";
import {
  ORDER_STATUS_META,
  ROLE_META,
  formatBaht,
  shortOrderId,
  type CenterOrderStatus,
} from "@velnox/shared/lib/shop";
import { formatCommissionRate } from "@velnox/shared/lib/commerce";
import { useAction, useMutation, useQuery } from "@velnox/shared/lib/api-routes";
import {
  AlertTriangle,
  BadgeCheck,
  Boxes,
  BrainCircuit,
  Coins,
  Crown,
  Globe,
  History,
  Image as ImageIcon,
  MessageCircle,
  Megaphone,
  KeyRound,
  Loader2,
  Package,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Tag,
  Target,
  TrendingUp,
  Truck,
  Users,
  Menu,
  PanelLeft,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "@velnox/shared/lib/flash-toast";

type Tab = "overview" | "marketing" | "orders" | "incidents" | "products" | "sellers" | "categories" | "staff" | "audit" | "settings" | "chat" | "tracking";

const DEPARTMENTS: { id: string; label: string }[] = [
  { id: "general", label: "ทั่วไป" },
  { id: "marketing", label: "การตลาด" },
  { id: "sales", label: "ฝ่ายขาย" },
  { id: "operations", label: "ปฏิบัติการ" },
  { id: "finance", label: "การเงิน" },
];

/** One page of the platform order list (the server caps `limit` at 200). */
const ORDER_PAGE_SIZE = 50;

const DEPARTMENT_LABEL: Record<string, string> = {
  general: "ทั่วไป",
  marketing: "การตลาด",
  sales: "ฝ่ายขาย",
  operations: "ปฏิบัติการ",
  finance: "การเงิน",
};

/**
 * Company / system settings sections. Each entry is backed by a REAL source:
 * `company` and `marketplace` write platform_settings; the rest display values
 * the backend owns (money policy, upload limits) read-only.
 */
const SETTINGS_SECTIONS = [
  { id: "company", label: "บริษัท / แพลตฟอร์ม", icon: Store },
  { id: "marketplace", label: "ตลาด & การอนุมัติ", icon: Package },
  { id: "commission", label: "ค่าธรรมเนียมผู้ขาย", icon: Coins },
  { id: "localization", label: "ภาษา & ท้องถิ่น", icon: Globe },
  { id: "media", label: "ไฟล์ & สื่อ", icon: ImageIcon },
  { id: "access", label: "สิทธิ์การเข้าถึง", icon: KeyRound },
] as const;

/**
 * velcenter permission model (company-only):
 * - owner:  everything, including managing employees
 * - admin:  business data + the customer directory + the read-only employee
 *           roster, but NO employee management (create/reset/permissions)
 *           (department-scoped in production; e.g. marketing admin)
 * - staff:  overview, plus exactly the business tabs their
 *           `employees.permissions` grants (orders.view, products.moderate,
 *           sellers.manage, audit.view, …) — a staff account with no grants
 *           sees only totals
 *
 * These rules only decide which tabs are OFFERED. Every endpoint behind them
 * re-checks the role AND the permission server-side, so hiding a tab is UX,
 * never authorization.
 */
/**
 * Display text for a counter that came from an API read.
 *
 * `null` means UNKNOWN — the read failed or has not finished — and renders an
 * em dash, matching the overview cards. It must never be coerced to 0: a
 * dashboard that says "0 บัญชีผู้ขาย" when the seller count is merely unknown is
 * stating a fact it does not have, and an owner reading it concludes the
 * marketplace is empty rather than that the request failed.
 *
 * The counters hold this TEXT rather than a number so that every place they are
 * shown — the tab badges, the directory header, the account summary sentence —
 * renders the unknown case identically. They are never used in arithmetic.
 */
function counterText(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(value);
}

function canSeeTab(
  tab: Tab,
  role?: string | null,
  department?: string | null,
  permissions?: string[] | null,
): boolean {
  // One grant rule for the whole screen (`roleHoldsPermission` mirrors
  // backend/lib/permissions.ts: owner/admin hold every code implicitly).
  const holds = (code: string) => roleHoldsPermission(role, permissions, code);

  switch (tab) {
    // Aggregate market numbers only — every center member may look.
    case "overview":
      return true;

    // Company chat is an operational surface for every VelCenter member
    // (owner / admin / staff). The endpoint independently re-checks that role
    // and never exposes a private customer↔seller thread.
    case "chat":
      return role === "owner" || role === "admin" || role === "staff";

    // Business surfaces map onto the permission catalog: a tab is OFFERED only
    // when the account holds its code. The endpoint re-checks regardless, so a
    // hidden tab is UX, never the authorization.
    case "orders":
      return holds("orders.view");
    // Money Stripe captured that the order lifecycle could not settle (audit
    // HIGH #5). The same `orders.view` code the orders tab already uses, and
    // the endpoints re-check it — a hidden tab is UX, never the authorization.
    case "incidents":
      return holds("orders.view");
    // Multi-carrier tracking management — same `orders.view` gate the orders
    // tab uses; every /api/admin/tracking endpoint re-checks it server-side.
    case "tracking":
      return holds("orders.view");
    case "products":
      return holds("products.moderate");
    case "sellers":
      return holds("sellers.manage");

    case "categories":
      return role === "owner" || role === "admin";
    // This tab merges three surfaces, each gated by its own code at the API:
    // the staff/customer directory is `users.manage` (GET /api/admin/users),
    // the employee roster is `staff.manage` (GET /api/admin/employees), and
    // employee MANAGEMENT (create / reset / permissions) is owner-only at the
    // endpoint — EmployeeManager withholds those controls for everyone else, so
    // opening the tab exposes only what the endpoints already permit.
    case "staff":
      return holds("users.manage") || holds("staff.manage");
    // owner/admin hold every permission code; a `staff` member needs
    // `audit.view` granted (the same code GET /api/admin/audit-logs checks).
    case "audit":
      return holds("audit.view");
    // Company control plane: the owner, an admin in the general department (the
    // platform's department rule), or a staff account the owner granted
    // `settings.manage` — the code GET/PATCH /api/admin/settings enforce.
    // Marketing shares the exact same gate: banners write platform_settings
    // through PUT /api/admin/announcements, which enforces settings.manage.
    case "settings":
    case "marketing":
      return role === "owner"
        || (role === "admin" && department === "general")
        || (role === "staff" && holds("settings.manage"));
  }
}

interface MarketInsights {
  topSearches: { q: string; count: number }[];
  topCategories: { category: string; label: string; count: number }[];
  popularProducts: { product: { id: string; name: string; price: number; unit: string; primaryImage?: { displayUrl: string } | null }; views: number }[];
  eventCount: number;
  windowDays: number;
}

export default function Center() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const realtimeState = useRealtimeState();
  const { t } = useLanguage();
  const userRole = user?.role;
  const userDepartment = user?.department;

  const isOwner = userRole === "owner";
  const userPermissions = user?.permissions ?? [];

  /** Mirrors backend/lib/permissions.ts for UI-only decisions. */
  const holds = (code: string) => roleHoldsPermission(userRole, userPermissions, code);

  // PATCH /api/admin/orders/:orderId/status requires `orders.manage`, so a
  // staff account granted it must get the controls too — a read-only screen for
  // a granted write permission is the same lie as a decorative checkbox.
  const canManageOrders = holds("orders.manage");

  // Tab visibility, resolved from role + department + the permissions the
  // backend resolved for this session.
  const canSee = (target: Tab) => canSeeTab(target, userRole, userDepartment, userPermissions);

  // Stable booleans for effect deps (`holds`/`canSee` are re-created per render).
  const canSeePeople = canSee("staff");
  const canSeeSettings = canSee("settings");
  // GET /api/admin/users (directory) and GET /api/admin/employees (roster) are
  // separate grants — an account may hold either one without the other.
  const canSeeDirectory = holds("users.manage");
  const canReadEmployees = holds("staff.manage");

  // Tabs are URL-driven (?tab=orders) so the mobile bottom nav and the desktop
  // tab strip stay in sync, and every view is shareable/deep-linkable.
  const [searchParams, setSearchParams] = useSearchParams();
  // Mobile navigation drawer + desktop rail collapse (presentation only).
  const [navOpen, setNavOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);

  // Drawer behaviour: Escape closes it and the page behind must not scroll.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [navOpen]);
  const urlTab = (searchParams.get("tab") as Tab | null) ?? "overview";
  const tab: Tab = canSee(urlTab) ? urlTab : "overview";
  const setTab = (next: Tab) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("tab", next);
        return params;
      },
      { replace: true },
    );
  };
  /**
   * Navigation triggers respond to a plain `click` as well as Radix's
   * `mousedown` activation. Assistive technology and synthetic activation send
   * `click` only, so mousedown-only switching left the tab rail inert for them
   * (and for automated browser QA).
   */
  const selectTab = (next: Tab) => {
    setTab(next);
    setNavOpen(false);
  };

// CPNS: aggregate marketplace interest (privacy-safe — no personal data).
  const marketInsightsAction = useAction(api.memory.marketInsights);
  const [market, setMarket] = useState<MarketInsights | null>(null);
  useEffect(() => {
    let alive = true;
    marketInsightsAction()
      .then((d) => alive && setMarket(d as unknown as MarketInsights))
      .catch(() => alive && setMarket(null));
    return () => {
      alive = false;
    };
  }, [marketInsightsAction]);

  // Goals + reorder intelligence + restocking
  // list, employees, store settings.
  const overview = useQuery(api.center.overview);
  const products = useQuery(api.products.listAll);

  // Seller applications + product moderation — the real Neon catalog
  // (spec §36–37). Approve/reject is server-checked + audit-logged.
  const setSellerStatusAction = useAction(api.centerAdmin.setSellerStatusAction);
  const setModerationAction = useAction(api.centerAdmin.setProductModerationStatus);
  // Exact counters for the overview badges — never the length of a fetched
  // queue (see reloadSellers / reloadProducts below).
  const dashboardCountsAction = useAction(api.centerAdmin.dashboardCounts);
  // ONE verification system: SELLER / SHOP identity verification.
  // Product verification was removed from the user workflow — there is no
  // product verification queue in VelCenter.
  const verificationsAction = useAction(api.admin.verifications);
  const [pendingSellers, setPendingSellers] = useState(0);
  const [pendingProducts, setPendingProducts] = useState(0);
  const [rejectingSeller, setRejectingSeller] = useState<SellerRow | null>(null);
  const [rejectingProduct, setRejectingProduct] = useState<ModProductRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [modBusy, setModBusy] = useState(false);
  // Exact pending-verification count for the overview badge. The queue itself is
  // paginated, so the counter asks for `limit: 1` and reads `pagination.total` —
  // every pending row is counted instead of however many fit on one page.
  const [pendingVerifications, setPendingVerifications] = useState(0);
  // The three queue reads below feed the overview counters and tab badges — a
  // failure must not silently read as "nothing pending".
  const [queueError, setQueueError] = useState<string | null>(null);

  interface SellerRow {
    id: string;
    name: string;
    tax_id: string | null;
    status: string;
    business_type: string | null;
    approved_at: string | null;
    created_at: string;
    owner_id: string | null;
    owner_name: string | null;
    owner_email: string | null;
    shop_count: number;
    product_count: number;
  }
  interface ModProductRow {
    id: string;
    name: string;
    price: string;
    status: string;
    created_at: string;
    shop_name: string;
    seller_name: string;
  }
  /** Read-only platform facts returned alongside the persisted settings. */
  interface PlatformMeta {
    moderation?: { approvalMode?: string; productVerificationEnabled?: boolean };
    commission?: { sellerRate?: number; returnCoverage?: number; currency?: string; editable?: boolean };
    media?: { maxUploadBytes?: number; allowedTypes?: string[] };
    role?: string;
  }
  /** One row from GET /api/admin/users — `role` is the real DB role. */
  interface DirectoryUser {
    _id: string;
    id: string;
    email: string | null;
    name: string | null;
    role: string | null;
    department: string | null;
    status: string;
    isStaff: boolean;
    createdAt: number;
  }
  const reloadSellers = useCallback(async () => {
    try {
      // REVIEWER WORK, counted in the database. `pendingReviewSellers` is an exact
      // COUNT of applications that still need a VelCenter decision (`pending` or
      // `under_review`); an APPROVED seller is excluded by definition, so the
      // badge cannot stay at 1 after an approval. Same endpoint the product badge
      // already reads — never a frontend decrement (which a refresh would undo).
      const counts = await dashboardCountsAction();
      setPendingSellers(Number(counts?.pendingReviewSellers ?? 0));
    } catch (error) {
      console.error("Seller count error:", error);
      // Empty must mean empty: a failed read keeps what we have and says so.
      setQueueError(error instanceof Error ? error.message : "โหลดตัวเลขคิวงานไม่สำเร็จ");
    }
  }, [dashboardCountsAction]);
  const reloadProducts = useCallback(async () => {
    try {
      // The moderation list endpoint is not paginated yet, so this count comes
      // from the dashboard counter (one COUNT query) rather than from this page
      // downloading the whole product list just to measure a badge.
      const counts = await dashboardCountsAction();
      setPendingProducts(Number(counts?.pendingProducts ?? 0));
    } catch (error) {
      console.error("Product moderation count error:", error);
      setQueueError(error instanceof Error ? error.message : "โหลดตัวเลขคิวงานไม่สำเร็จ");
    }
  }, [dashboardCountsAction]);

  const reloadVerifications = useCallback(async () => {
    try {
      // One persisted source — the same seller_verifications rows the seller
      // wrote — read as an exact count. It is a COUNT OVER() on the backend, so
      // the overview no longer pulls whole queues into the browser to count them.
      const pending = await verificationsAction({ status: "pending", limit: 1 });
      setPendingVerifications(Number(pending?.pagination?.total ?? 0));
    } catch (error) {
      console.error("Verification count error:", error);
      // A failed read keeps the last known count and surfaces the error.
      setQueueError(error instanceof Error ? error.message : "โหลดตัวเลขคิวงานไม่สำเร็จ");
    }
  }, [verificationsAction]);

  /**
   * Which queue reads this account is ALLOWED to make.
   *
   * The overview counters used to fire all three unconditionally. A staff account
   * that was granted `orders.view` + `products.moderate` but not `sellers.manage`
   * therefore called the reviewer queue, got `403 Admin access required`, and the
   * page reported "โหลดตัวเลขคิวงานไม่สำเร็จ" — a permission it never had read as a
   * broken dashboard. Each counter now follows its own permission, so a staff
   * member sees the numbers they can actually act on and nothing else.
   */
  const queueRights = useMemo(
    () => ({
      sellers: roleHoldsPermission(user?.role, user?.permissions, "sellers.manage"),
      products: roleHoldsPermission(user?.role, user?.permissions, "products.moderate"),
      verifications: roleHoldsPermission(user?.role, user?.permissions, "sellers.manage"),
    }),
    [user?.role, user?.permissions],
  );

  /** Re-read the queues behind the overview counters, within this account's rights. */
  const retryQueues = useCallback(() => {
    setQueueError(null);
    if (queueRights.sellers) void reloadSellers();
    if (queueRights.products) void reloadProducts();
    if (queueRights.verifications) void reloadVerifications();
  }, [reloadSellers, reloadProducts, reloadVerifications, queueRights]);

  useEffect(() => {
    retryQueues();
  }, [retryQueues]);

  // One realtime signal, one refetch per consumer. Whichever source raises
  // "sellers" — the WebSocket handler above, or the verification queue right
  // after a reviewer decision — this page re-reads the authoritative counters,
  // so the badge follows the database instead of a local guess.
  useEffect(
    () =>
      onCenterEvent("sellers", () => {
        if (queueRights.sellers) void reloadSellers();
        if (queueRights.verifications) void reloadVerifications();
      }),
    [reloadSellers, reloadVerifications, queueRights],
  );

  // Realtime for VelCenter queues — the ONE shared socket (same client the
  // storefront and seller apps use), not a second inline WebSocket. The shared
  // client connects to `<origin>/ws`, which is the only path the server accepts,
  // and handles backoff, jitter and resubscription itself.
  //
  // Every event is a SIGNAL: each consumer re-reads its data from the API. After
  // a reconnect all queues are refreshed once, because anything published while
  // the socket was down was never delivered.
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    connectChatSocket(user.id);

    // Private VelCenter channels. The server authorizes each subscription from
    // `users.role` server-side; a customer or seller connection is refused.
    //
    // `order:created` / `order:updated` / `shipment:updated` are deliberately
    // NOT subscribed: order-scoped events are ADDRESSED by the server to the
    // sessions entitled to them (the order's customer, the shop's seller and
    // every connected VelCenter session), so this console receives them without
    // subscribing to anything — and no client can subscribe to a feed of other
    // people's orders.
    const unsubscribes = [
      subscribeChatChannel("product:updated"),
      subscribeChatChannel("seller:updated"),
      subscribeChatChannel("notification:created"),
      subscribeChatChannel("audit:created"),
      subscribeChatChannel("config:updated"),
    ];

    const offAny = onAnyChatEvent((type) => {
      // Fan out to the tabs that own their own data (the product and seller
      // queues, orders, audit logs). The event is only a signal that something
      // changed; the tab refetches from the API.
      if (type === "product:moderated" || type === "product:updated") {
        void reloadProducts();
        emitCenterEvent("products");
      }
      if (type === "seller:status-changed" || type === "verification:status-changed") {
        emitCenterEvent("sellers");
      }
      if (type === "order:updated" || type === "order:created" || type === "shipment:updated") {
        emitCenterEvent("orders");
      }
      // `employee:created` / `employee:updated` are broadcast when a center
      // session creates or changes an account — the roster and the directory
      // both re-read from the API.
      if (type === "employee:created" || type === "employee:updated") {
        emitCenterEvent("staff");
      }
      // Platform configuration changed in another session — the category tree
      // and the settings form both re-read from the API.
      if (type === "config:updated") {
        emitCenterEvent("config");
      }
      if (
        type === "audit:created" ||
        type === "product:moderated" ||
        type === "product:updated" ||
        type === "seller:status-changed" ||
        type === "verification:status-changed" ||
        type === "order:updated" ||
        type === "order:created" ||
        type === "shipment:updated"
      ) {
        emitCenterEvent("audit");
      }
    });

    // Re-read everything once the transport is back: events published while it
    // was down were never delivered, so the console must not trust its state.
    const offReconnect = onChatReconnect(() => {
      void reloadSellers();
      void reloadProducts();
      void reloadVerifications();
      emitCenterEvent("orders");
      emitCenterEvent("sellers");
      emitCenterEvent("products");
      emitCenterEvent("staff");
      emitCenterEvent("config");
      emitCenterEvent("audit");
    });

    return () => {
      offAny();
      offReconnect();
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [isAuthenticated, user?.id, reloadProducts, reloadVerifications, reloadSellers]);

  // Both badges are exact counts held in state (reloadSellers / reloadProducts),
  // not the length of a fetched queue.

  // The verification queue filters, searches and pages on the SERVER (it holds
  // no rows here any more) — this page only needs the exact pending count.

  const handleSellerStatus = async (seller: SellerRow, status: string) => {
    // Frontend guard: cannot approve/reject own seller application
    if (seller.owner_id && seller.owner_id === user?._id && (status === "approved" || status === "rejected")) {
      toast.error("ไม่สามารถอนุมัติหรือปฏิเสธร้านของตัวเองได้");
      return;
    }
    setModBusy(true);
    try {
      await setSellerStatusAction({
        sellerId: seller.id,
        status,
        reason: rejectReason.trim() || undefined,
      });
      toast.success(status === "approved" ? "อนุมัติพ่อค้าแล้ว" : status === "rejected" ? "ปฏิเสธใบสมัครแล้ว" : "อัปเดตสถานะแล้ว");
      setRejectingSeller(null);
      setRejectReason("");
      await reloadSellers();
    } catch (error) {
      console.error("Seller status error:", error);
      toast.error(error instanceof Error ? error.message : "ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setModBusy(false);
    }
  };

  const handleProductModeration = async (product: ModProductRow, status: string) => {
    setModBusy(true);
    try {
      await setModerationAction({
        productId: product.id,
        status,
        reason: rejectReason.trim() || undefined,
      });
      toast.success(status === "published" ? "อนุมัติสินค้าแล้ว" : "ปฏิเสธสินค้าแล้ว");
      setRejectingProduct(null);
      setRejectReason("");
      await reloadProducts();
    } catch (error) {
      console.error("Product moderation error:", error);
      toast.error(error instanceof Error ? error.message : "ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setModBusy(false);
    }
  };

  // ── People directory (spec §9–§11) ───────────────────────────────────────
  // Staff and customers are SEPARATE lists, filtered server-side by the real
  // `users.role` values — never by fuzzy matching in the browser. Role / dept
  // changes are owner-only and audit-logged server-side.
  const listUsersAction = useAction(api.users.listUsers);
  const setUserAccess = useMutation(api.users.setUserAccess);
  const [staffUsers, setStaffUsers] = useState<DirectoryUser[] | null>(null);
  const [customerUsers, setCustomerUsers] = useState<DirectoryUser[] | null>(null);
  const [peopleCounts, setPeopleCounts] = useState<{ staff: string; customer: string; seller: string }>({ staff: "—", customer: "—", seller: "—" });
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [peopleSegment, setPeopleSegment] = useState<"staff" | "customer">("staff");
  const [customerSearch, setCustomerSearch] = useState("");

  const loadPeople = useCallback(async () => {
    setPeopleError(null);
    try {
      const [staffRes, customerRes] = await Promise.all([
        listUsersAction({ segment: "staff" }),
        listUsersAction({ segment: "customer" }),
      ]);
      setStaffUsers((staffRes?.users ?? []) as DirectoryUser[]);
      setCustomerUsers((customerRes?.users ?? []) as DirectoryUser[]);
      const counts = customerRes?.counts ?? staffRes?.counts;
      if (counts) {
        setPeopleCounts({
          staff: counterText(counts.staff),
          customer: counterText(counts.customer),
          seller: counterText(counts.seller),
        });
      }
    } catch (error) {
      console.error("Users list error:", error);
      setPeopleError(error instanceof Error ? error.message : "โหลดรายชื่อผู้ใช้ไม่สำเร็จ");
      // Unknown, not zero — the counters below render "—" so a failed read is
      // never reported as an empty platform.
      setPeopleCounts({ staff: "—", customer: "—", seller: "—" });
      setStaffUsers([]);
      setCustomerUsers([]);
    }
  }, [listUsersAction]);

  useEffect(() => {
    // Directory reads are `users.manage`; fetching without the grant is a 403.
    if (!canSeePeople || !canSeeDirectory) return;
    void loadPeople();
    // Creating / activating / re-permissioning an employee changes the
    // directory too — the backend's `employee:*` events land here as "staff".
    return onCenterEvent("staff", () => {
      void loadPeople();
    });
  }, [canSeePeople, canSeeDirectory, loadPeople]);

  // Storefront settings now live in Neon platform_settings (spec §15–16) —
  // read/write through the center actions (owner/admin, audit-logged).
  // Company / system settings live in Neon `platform_settings`. The endpoint
  // returns the persisted rows PLUS backend-owned read-only meta (commission
  // policy, upload limits) so nothing here is invented client-side.
  const getPlatformSettingsAction = useAction(api.centerAdmin.getPlatformSettings);
  const updatePlatformSettingAction = useAction(api.centerAdmin.updatePlatformSettingAction);
  const permissionCatalogAction = useAction(api.centerAdmin.permissionCatalog);
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [settingsMeta, setSettingsMeta] = useState<PlatformMeta | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSection, setSettingsSection] = useState<
    "company" | "marketplace" | "commission" | "localization" | "media" | "access"
  >("company");
  const [permissionCatalog, setPermissionCatalog] = useState<{ code: string; label: string; description: string }[]>([]);

  const loadSettings = useCallback(async () => {
    try {
      const res = await getPlatformSettingsAction();
      const map: Record<string, string> = {};
      for (const s of res?.settings ?? []) map[s.key] = String(s.value ?? "");
      setSettings(map);
      setSettingsMeta((res?.meta ?? null) as PlatformMeta | null);
      setSettingsError(null);
    } catch (error) {
      console.error("Platform settings error:", error);
      setSettings(null);
      setSettingsMeta(null);
      setSettingsError(error instanceof Error ? error.message : "โหลดการตั้งค่าไม่สำเร็จ");
    }
  }, [getPlatformSettingsAction]);

  useEffect(() => {
    // Settings are `settings.manage`; the tab uses the same policy.
    if (!canSeeSettings) return;
    void loadSettings();
  }, [canSeeSettings, loadSettings]);

  useEffect(() => {
    if (!isOwner) return;
    void permissionCatalogAction()
      .then((c) => setPermissionCatalog(Array.isArray(c) ? c : []))
      .catch(() => setPermissionCatalog([]));
  }, [isOwner, permissionCatalogAction]);

  // Marketplace KPIs + orders come from the Neon commerce core (velcenter used
  // to read tables that checkout never writes → 0/wrong numbers).
  const marketOverviewAction = useAction(api.centerAdmin.marketOverviewAction);
  const ordersListAction = useAction(api.centerAdmin.ordersPageAction);
  const updateOrderStatusAction = useAction(api.centerAdmin.updateOrderStatusAction);

  interface MarketOverview {
    revenue: number;
    /** The company's own cut of that revenue — 3% of every sold item. */
    commissionRevenue?: number;
    commissionRate?: number;
    orderCount: number;
    pendingOrders: number;
    completedOrders: number;
    productCount: number;
    publishedCount: number;
    customerCount: number;
    sellerCount: number;
  }
  interface CenterOrderItem {
    id: string;
    productName: string;
    unit: string;
    quantity: number;
    subtotal: number;
  }
  interface CenterOrderRow {
    id: string;
    orderNumber: string;
    status: string;
    createdAt: number; // epoch ms
    total: number;
    customerName: string;
    customerPhone: string;
    itemCount: number;
    shopName: string | null;
    items: CenterOrderItem[];
  }

  /** `GET /api/admin/orders?paginated=1` */
  interface OrdersPage {
    orders: CenterOrderRow[];
    pagination?: { limit: number; offset: number; total: number; hasMore: boolean };
  }

  const [marketKpi, setMarketKpi] = useState<MarketOverview | null>(null);
  const [ordersData, setOrdersData] = useState<CenterOrderRow[] | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  /** Pagination: the platform order list is walked page by page. */
  const [ordersHasMore, setOrdersHasMore] = useState(false);
  const [ordersLoadingMore, setOrdersLoadingMore] = useState(false);
  const ordersMoreRef = useRef(false);
  const ordersRef = useRef<CenterOrderRow[]>([]);
  /** Sequence guard: a stale page/refresh answer must never overwrite a newer one. */
  const ordersSeqRef = useRef(0);

  const loadMarket = useCallback(async () => {
    try {
      setMarketKpi(await marketOverviewAction());
    } catch {
      setMarketKpi(null);
    }
  }, [marketOverviewAction]);

  /** First page (or a refresh). Always restarts at offset 0. */
  const loadOrders = useCallback(async () => {
    const seq = ++ordersSeqRef.current;
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const page = (await ordersListAction({
        limit: ORDER_PAGE_SIZE,
        offset: 0,
      })) as OrdersPage | null;
      if (seq !== ordersSeqRef.current) return;
      setOrdersData(page?.orders ?? []);
      setOrdersHasMore(Boolean(page?.pagination?.hasMore));
    } catch (err) {
      if (seq !== ordersSeqRef.current) return;
      // A failed request must never render as “no orders”.
      console.error("Orders list error:", err);
      setOrdersError(err instanceof Error ? err.message : "ไม่สามารถโหลดออเดอร์ได้");
      setOrdersData(null);
      setOrdersHasMore(false);
    } finally {
      if (seq === ordersSeqRef.current) setOrdersLoading(false);
    }
  }, [ordersListAction]);

  /** Next page. Ref-guarded against double taps, deduplicated by order id. */
  const loadMoreOrders = useCallback(async () => {
    if (ordersMoreRef.current || !ordersHasMore) return;
    ordersMoreRef.current = true;
    setOrdersLoadingMore(true);
    const seq = ordersSeqRef.current;
    try {
      const page = (await ordersListAction({
        limit: ORDER_PAGE_SIZE,
        offset: ordersRef.current.length,
      })) as OrdersPage | null;
      if (seq !== ordersSeqRef.current) return;
      const next = page?.orders ?? [];
      setOrdersData((prev) => {
        const existing = prev ?? [];
        const seen = new Set(existing.map((o) => o.id));
        return [...existing, ...next.filter((o) => !seen.has(o.id))];
      });
      setOrdersHasMore(Boolean(page?.pagination?.hasMore));
      setOrdersError(null);
    } catch (err) {
      if (seq !== ordersSeqRef.current) return;
      console.error("Load more orders error:", err);
      setOrdersError(err instanceof Error ? err.message : "ไม่สามารถโหลดออเดอร์เพิ่มได้");
    } finally {
      ordersMoreRef.current = false;
      setOrdersLoadingMore(false);
    }
  }, [ordersListAction, ordersHasMore]);

  ordersRef.current = ordersData ?? [];

  useEffect(() => {
    void loadMarket();
  }, [loadMarket]);

  useEffect(() => {
    if (tab === "orders") void loadOrders();
  }, [tab, loadOrders]);

  // Realtime order changes (from any VelCenter tab) refetch the list.
  useEffect(() => onCenterEvent("orders", () => { void loadOrders(); }), [loadOrders]);

  // Platform settings changed in another session → re-read them. The category
  // tree is owned by CategoriesManagement, which listens to the same event.
  useEffect(() => onCenterEvent("config", () => { void loadSettings(); }), [loadSettings]);

  const pendingOrders = (ordersData ?? []).filter((o) => o.status === "pending").length;

  // Next valid statuses per the Neon fulfilment state machine (mirrors
  // FULFILLMENT_TRANSITIONS in backend/lib/order-fulfillment.ts) — center can
  // only move an order forward. `packing` is the point of no return: `confirmed`
  // → `packing` is offered, and `packing` only offers `shipped`, so neither side
  // can cancel an order that is already being packed.
  const NEXT_STATUS: Record<string, string[]> = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["packing", "cancelled"],
    packing: ["shipped"],
    shipped: ["delivered"],
    delivered: ["completed"],
    completed: [],
    cancelled: [],
  };
  const statusOptions = (current: string): string[] => [
    current,
    ...(NEXT_STATUS[current] ?? []),
  ];

  /**
   * Which ORDER row is mid-mutation. Per row, not per table: cancelling order A
   * must not freeze order B, and a second click on A must not send a second
   * mutation. `null` means nothing is in flight.
   */
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  const handleOrderStatus = async (orderId: string, status: string) => {
    if (!canManageOrders) return;
    if (busyOrderId === orderId) return; // double-submit guard for THIS row
    // `shipped` means the parcel really exists: it requires a shipment with a
    // carrier and a tracking number, so those are collected first and sent WITH
    // the transition (see components/OrderShipDialog.tsx). The backend refuses
    // `packing → shipped` without them no matter what this UI offers.
    if (status === "shipped") {
      openOrderShipDialog(orderId);
      return;
    }
    // Cancelling an order releases reserved stock and ends the purchase — it is
    // irreversible, so it is confirmed before anything is sent.
    if (status === "cancelled") {
      const ok = window.confirm(
        "ยกเลิกออเดอร์นี้? สต็อกที่จองไว้จะถูกคืน และลูกค้าจะไม่สามารถชำระเงินได้อีก",
      );
      if (!ok) return;
    }
    setBusyOrderId(orderId);
    try {
      await updateOrderStatusAction({ orderId, status });
      toast.success("อัปเดตสถานะออเดอร์แล้ว");
      // Refetch the authoritative list instead of guessing the new state.
      await loadOrders();
      // …and the platform counters (the tab badge reads `marketKpi.pendingOrders`).
      void loadMarket();
    } catch (error) {
      console.error("Update order status error:", error);
      toast.error(
        error instanceof Error ? error.message : "อัปเดตไม่สำเร็จ กรุณาลองอีกครั้ง",
      );
      // The row still shows its server status; re-read so the UI cannot appear
      // to have applied a change the server rejected.
      void loadOrders();
    } finally {
      setBusyOrderId(null);
    }
  };

  /** Which USER row is mid-mutation (role / department change). */
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const handleSetUserAccess = async (
    userId: string,
    role: "customer" | "seller" | "admin" | "owner" | "staff",
    department?: string,
  ) => {
    if (busyUserId === userId) return; // double-submit guard for THIS row
    // Role changes grant or remove real power (an elevated role reaches the
    // whole marketplace, `customer` removes access) — confirm before sending.
    const current = [...(staffUsers ?? []), ...(customerUsers ?? [])].find(
      (u) => u._id === userId,
    );
    if (current && (current.role ?? "customer") !== role) {
      const label = ROLE_META[role]?.label ?? role;
      const ok = window.confirm(
        `เปลี่ยนสิทธิ์ของบัญชีนี้เป็น “${label}”? การเปลี่ยนมีผลทันทีกับทุกหน้าที่ใช้สิทธิ์นี้`,
      );
      if (!ok) return;
    }
    setBusyUserId(userId);
    try {
      await setUserAccess({
        targetUserId: userId,
        role,
        department: department as
          | "general"
          | "marketing"
          | "sales"
          | "operations"
          | "finance"
          | undefined,
      });
      toast.success("อัปเดตสิทธิ์แล้ว");
      // Role changes move an account between the staff and customer lists, so
      // the authoritative state is re-read rather than patched locally.
      await loadPeople();
    } catch (error) {
      console.error("Set access error:", error);
      toast.error(error instanceof Error ? error.message : "อัปเดตไม่สำเร็จ");
      // Keep the row honest: it must show the role the server still holds.
      void loadPeople();
    } finally {
      setBusyUserId(null);
    }
  };

  // ---- Settings form ----
  const [form, setForm] = useState({
    shopName: "",
    tagline: "",
    phone: "",
    address: "",
    announcement: "",
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [approvalMode, setApprovalMode] = useState<string>("manual");
  const [savingApproval, setSavingApproval] = useState(false);

  useEffect(() => {
    if (settings && !settingsLoaded) {
      setForm({
        shopName: settings["store_shop_name"] ?? "",
        tagline: settings["store_tagline"] ?? "",
        phone: settings["store_phone"] ?? "",
        address: settings["store_address"] ?? "",
        announcement: settings["store_announcement"] ?? "",
      });
      if (settings["product_approval_mode"]) {
        setApprovalMode(settings["product_approval_mode"]);
      }
      setSettingsLoaded(true);
    }
  }, [settings, settingsLoaded]);

  const handleApprovalModeChange = async (mode: string) => {
    setSavingApproval(true);
    try {
      await updatePlatformSettingAction({ key: "product_approval_mode", value: mode });
      setApprovalMode(mode);
      toast.success(mode === "auto" ? "เปิดระบบอนุมัติอัตโนมัติแล้ว" : "ปิดระบบอนุมัติอัตโนมัติแล้ว");
    } catch (error) {
      console.error("Update approval mode error:", error);
      toast.error("ไม่สามารถเปลี่ยนโหมดอนุมัติได้");
    } finally {
      setSavingApproval(false);
    }
  };

  const handleSaveSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingSettings(true);
    try {
      const entries: [string, string][] = [
        ["store_shop_name", form.shopName],
        ["store_tagline", form.tagline],
        ["store_phone", form.phone],
        ["store_address", form.address],
        ["store_announcement", form.announcement],
      ];
      // Only send what actually changed — one audited write per real change,
      // no audit noise from re-saving untouched fields.
      const changed = entries.filter(([key, value]) => (settings?.[key] ?? "") !== value.trim());
      if (changed.length === 0) {
        toast.info("ไม่มีการเปลี่ยนแปลง");
        return;
      }
      await Promise.all(changed.map(([key, value]) => updatePlatformSettingAction({ key, value: value.trim() })));
      toast.success("บันทึกการตั้งค่าระบบแล้ว");
      await loadSettings();
    } catch (error) {
      console.error("Update settings error:", error);
      toast.error(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setSavingSettings(false);
    }
  };

  const stats = useMemo(() => {
    const o = overview; // company goals
    const m = marketKpi; // marketplace KPIs (Neon commerce core — real data)
    return [
      { icon: TrendingUp, label: "ยอดขายรวม", value: m ? formatBaht(m.revenue) : "—", sub: "ออเดอร์ที่เสร็จสิ้น", accent: "text-emerald-600" },
      // Company income, not seller income: the commission kept from each sold item.
      {
        icon: Coins,
        label: "รายได้บริษัท",
        value: m && m.commissionRevenue != null ? formatBaht(m.commissionRevenue) : "—",
        sub: m?.commissionRate != null ? formatCommissionRate(m.commissionRate) + " ต่อชิ้นที่ขายได้" : "—",
        accent: "text-emerald-700",
      },
      { icon: ShoppingBag, label: "ออเดอร์ทั้งหมด", value: m ? String(m.orderCount) : "—", sub: m ? `${m.pendingOrders ?? 0} รอจัดการ` : "—", accent: "text-sky-600" },
      { icon: Target, label: "เป้าหมายสำเร็จ", value: o ? `${o.goalsAchieved}/${o.goalsTotal}` : "—", sub: "จากทั้งหมด", accent: "text-slate-700" },
      { icon: Users, label: "ลูกค้า", value: m ? String(m.customerCount) : "—", sub: "บัญชีลูกค้า", accent: "text-amber-600" },
      { icon: Store, label: "ร้านค้าอนุมัติ", value: m ? String(m.sellerCount) : "—", sub: "seller ที่ผ่านอนุมัติ", accent: "text-slate-700" },
      { icon: Package, label: "สินค้าทั้งหมด", value: m ? String(m.productCount) : "—", sub: m ? `${m.publishedCount ?? 0} รายการประกาศขาย` : "—", accent: "text-slate-700" },
      { icon: Boxes, label: "สต็อกต่ำ", value: o ? String(o.lowStockCount) : "—", sub: "ถึงจุดสั่งซื้อซ้ำ", accent: "text-rose-600" },
      { icon: AlertTriangle, label: "ต้องสั่งด่วน", value: o ? String(o.dueReorderCount) : "—", sub: "เลยรอบการสั่ง", accent: "text-rose-600" },
    ];
  }, [overview, marketKpi]);

  // Customer search is local to the already-fetched customer segment.
  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    const list = customerUsers ?? [];
    if (!q) return list;
    return list.filter(
      (u) =>
        (u.name ?? "").toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q),
    );
  }, [customerUsers, customerSearch]);

  // Spec §10: an employee who was just created / reset must pick a new
  // password before the company dashboard is usable. `users.currentUser` is
  // reactive, so the gate unmounts itself once mustChangePassword flips false.
  if (user?.mustChangePassword === true) {
    return <ChangePasswordScreen />;
  }

  return (
    <div className="min-h-screen bg-background text-slate-900">
      <header className="sticky top-0 z-40 border-b border-white/15 bg-brand">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2 sm:gap-5">
            <button type="button" onClick={() => navigate("/")} aria-label="velcenter">
              <Logo tone="light" wordmarkClassName="max-w-[140px] overflow-hidden truncate" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setNavCollapsed((value) => !value)}
              aria-label={navCollapsed ? "ขยายเมนู" : "ย่อเมนู"}
              aria-pressed={navCollapsed}
              className="hidden size-9 items-center justify-center rounded-lg text-white hover:bg-white/15 md:flex"
            >
              <PanelLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="เมนู"
              aria-expanded={navOpen}
              aria-controls="center-nav"
              className="flex size-9 items-center justify-center rounded-lg text-white hover:bg-white/15 md:hidden"
            >
              <Menu className="size-5" />
            </button>
            <LanguageSwitcher tone="brand" />
            <UserMenu tone="brand" />
          </div>
        </div>
      </header>

      {navOpen && (
        <button
          type="button"
          aria-label="ปิดเมนู"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 cursor-default bg-slate-900/40 md:hidden"
        />
      )}

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
            <ShieldCheck className="size-4 text-brand" />
            velcenter · ศูนย์กลางบริษัท
            {userRole && (
              <Badge className="ml-1 gap-1 rounded-full bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/15">
                {userRole === "owner" ? (
                  <>
                    <Crown className="size-3" />
                    เจ้าของบริษัท
                  </>
                ) : (
                  ROLE_META[userRole as keyof typeof ROLE_META]?.label ?? userRole
                )}
                {userDepartment && ` · ${DEPARTMENT_LABEL[userDepartment] ?? userDepartment}`}
              </Badge>
            )}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("center.title")}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            {t("center.subtitle")}
          </p>
          {/* Subtle transport state — no badge while live, no blocking error
              while reconnecting (REST still works). */}
          {realtimeState !== "open" && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/15">
              <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
              {t("center.realtime.reconnecting")}
            </p>
          )}
        </div>

        {queueError && (
          <div className="mt-6 flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm text-red-700">
              <AlertTriangle className="size-4 shrink-0" />
              {t("center.queue.loadFailed")} {queueError}
            </p>
            <Button variant="outline" size="sm" className="shrink-0 rounded-md" onClick={retryQueues}>
              ลองใหม่
            </Button>
          </div>
        )}

        <Tabs
          value={tab}
          onValueChange={(v) => selectTab(v as Tab)}
          className={`mt-6 md:grid md:items-start md:gap-6 md:[&>[role=tabpanel]]:col-start-2 md:[&>[role=tabpanel]]:min-w-0 ${
            navCollapsed ? "md:grid-cols-[4.5rem_minmax(0,1fr)]" : "md:grid-cols-[15rem_minmax(0,1fr)]"
          }`}
        >
          {/* R4: when the rail is collapsed the labels are hidden — without this
              they paint across the content column (brief audit R4). The drawer
              (mobile) and the expanded rail keep full labels. */}
          <div
            className={
              navOpen
                ? "fixed inset-x-0 bottom-0 top-16 z-50 w-72 overflow-y-auto border-r border-slate-200 bg-white px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-xl md:static md:z-auto md:w-full md:overflow-visible md:border-0 md:bg-transparent md:px-0 md:pb-0 md:pt-0 md:shadow-none"
                : "hidden md:block"
            }
          >
            {navOpen && (
              <div className="mb-2 flex items-center justify-between px-1 md:hidden">
                <p className="text-2xs font-semibold uppercase tracking-wide text-slate-400">
                  {t("velcenter.nav.sections")}
                </p>
                <button
                  type="button"
                  onClick={() => setNavOpen(false)}
                  aria-label="ปิดเมนู"
                  className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <X className="size-4" />
                </button>
              </div>
            )}
<TabsList
            id="center-nav"
            aria-label={t("velcenter.nav.sections")}
            className={`flex h-auto w-full flex-col items-stretch gap-0.5 [&_[role=tab]]:w-full [&_[role=tab]]:justify-start [&_[role=tab]]:px-3 [&_[role=tab]]:min-h-11 ${
              navCollapsed
                ? "[&_[role=tab]]:justify-center [&_[role=tab]_.nav-label]:sr-only"
                : ""
            }`}>
            {/* R5: min-h-11 keeps every nav row at the 44px touch target
                (the shared TabsTrigger base is py-1 ≈ 36px). Labels stay visible
                in the drawer and the expanded rail; the collapsed rail keeps
                them for screen readers only (R4) — each tab still has an
                accessible name because the icon alone is not a name. */}
            <TabsTrigger value="overview" onClick={() => selectTab("overview")} className="gap-1.5 rounded-md">
              <TrendingUp className="size-4" /> <span className="nav-label">{t("velcenter.nav.overview")}</span>
            </TabsTrigger>
            <TabsTrigger value="chat" onClick={() => selectTab("chat")} className="gap-1.5 rounded-md">
              <MessageCircle className="size-4" /> <span className="nav-label">{t("velcenter.nav.chat")}</span>
            </TabsTrigger>
            <TabsTrigger value="orders" onClick={() => selectTab("orders")} className="gap-1.5 rounded-md">
              <ShoppingBag className="size-4" /> <span className="nav-label">{t("velcenter.nav.orders")}</span>
              {/*
                The badge must not depend on how many rows happen to be loaded:
                with pagination the first page can hold zero pending orders while
                the real count sits further down. `marketKpi` is the exact
                platform figure; the page-derived count is only the fallback.
              */}
              {(marketKpi?.pendingOrders ?? pendingOrders) > 0 && (
                <span className="rounded-full bg-rose-500 px-1.5 text-2xs font-bold text-white">
                  {marketKpi?.pendingOrders ?? pendingOrders}
                </span>
              )}
            </TabsTrigger>

            <TabsTrigger value="products" onClick={() => selectTab("products")} className="gap-1.5 rounded-md">
              <Package className="size-4" /> <span className="nav-label">{t("velcenter.nav.products")}</span>
              {pendingProducts > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 text-2xs font-bold text-white">
                  {pendingProducts}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="sellers" onClick={() => selectTab("sellers")} className="gap-1.5 rounded-md">
              <Store className="size-4" /> <span className="nav-label">{t("velcenter.nav.sellers")}</span>
              {pendingSellers > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 text-2xs font-bold text-white">
                  {pendingSellers}
                </span>
              )}
            </TabsTrigger>
            {canSee("categories") && (
              <TabsTrigger value="categories" onClick={() => selectTab("categories")} className="gap-1.5 rounded-md">
                <Tag className="size-4" /> <span className="nav-label">{t("velcenter.nav.categories")}</span>
              </TabsTrigger>
            )}

            {canSee("staff") && (
              <TabsTrigger value="staff" onClick={() => selectTab("staff")} className="gap-1.5 rounded-md">
                <Users className="size-4" /> <span className="nav-label">{t("velcenter.nav.staff")}</span>
              </TabsTrigger>
            )}
            {canSee("audit") && (
              <TabsTrigger value="audit" onClick={() => selectTab("audit")} className="gap-1.5 rounded-md">
                <History className="size-4" /> <span className="nav-label">{t("velcenter.nav.auditLog")}</span>
              </TabsTrigger>
            )}
            {canSee("incidents") && (
              <TabsTrigger value="incidents" onClick={() => selectTab("incidents")} className="gap-1.5 rounded-md">
                <AlertTriangle className="size-4" /> <span className="nav-label">{t("velcenter.nav.paymentIncidents")}</span>
              </TabsTrigger>
            )}
            {canSee("tracking") && (
              <TabsTrigger value="tracking" onClick={() => selectTab("tracking")} className="gap-1.5 rounded-md">
                <Truck className="size-4" /> <span className="nav-label">การติดตามพัสดุ</span>
              </TabsTrigger>
            )}
            {canSee("marketing") && (
              <TabsTrigger value="marketing" onClick={() => selectTab("marketing")} className="gap-1.5 rounded-md">
                <Megaphone className="size-4" /> <span className="nav-label">{t("velcenter.nav.marketing")}</span>
              </TabsTrigger>
            )}
            {canSee("settings") && (
              <TabsTrigger value="settings" onClick={() => selectTab("settings")} className="gap-1.5 rounded-md">
                <Settings className="size-4" /> <span className="nav-label">ตั้งค่าระบบ</span>
              </TabsTrigger>
            )}
          </TabsList>
          </div>

          {/* ============ Chat (customers / sellers / internal) ============ */}
          <TabsContent value="chat" className="mt-6">
            <ChatManagement />
          </TabsContent>

          {/* ============ Overview ============ */}
          <TabsContent value="overview" className="mt-6">
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                  <div className="flex items-center gap-2">
                    <s.icon className={`size-4 ${s.accent}`} />
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      {s.label}
                    </p>
                  </div>
                  <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
                    {s.value}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{s.sub}</p>
                </div>
              ))}
            </div>

            {/* Action Required */}
            {(pendingProducts > 0 || pendingSellers > 0 || pendingVerifications > 0) && (
              <Card className="mt-6 border-amber-200 bg-amber-50/50 shadow-none">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle className="size-4 text-amber-500" />
                    ต้องดำเนินการ
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {pendingProducts > 0 && (
                      <button type="button" onClick={() => setTab("products")} className="flex w-full items-center justify-between rounded-xl bg-white p-3 text-left transition-colors hover:border-amber-300 border border-amber-200">
                        <span className="text-sm text-slate-700">สินค้ารอตรวจสอบ</span>
                        <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">{pendingProducts}</span>
                      </button>
                    )}
                    {pendingSellers > 0 && (
                      <button type="button" onClick={() => setTab("sellers")} className="flex w-full items-center justify-between rounded-xl bg-white p-3 text-left transition-colors hover:border-amber-300 border border-amber-200">
                        <span className="text-sm text-slate-700">ใบสมัครพ่อค้ารอตรวจสอบ</span>
                        <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">{pendingSellers}</span>
                      </button>
                    )}
                    {pendingVerifications > 0 && (
                      <button type="button" onClick={() => setTab("products")} className="flex w-full items-center justify-between rounded-xl bg-white p-3 text-left transition-colors hover:border-amber-300 border border-amber-200">
                        <span className="text-sm text-slate-700">การยืนยันรอตรวจสอบ</span>
                        <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">{pendingVerifications}</span>
                      </button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* The "Velnox Intelligence" summary card is gone with the tab: it
                led with a restock counter nobody used. What is left is the real
                marketplace picture — sales that actually completed, and orders
                still waiting on a decision. */}
            <Card className="mt-6 border-slate-200 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="size-4 text-brand" />
                  สรุปภาพรวมร้านค้า
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-emerald-50 p-4">
                    <p className="text-xs font-medium text-emerald-600">ยอดขายจาก velshop</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">
                      {marketKpi ? formatBaht(marketKpi.revenue) : "—"}
                    </p>
                    <p className="mt-0.5 text-xs text-emerald-600/70">
                      จากออเดอร์ที่เสร็จสิ้น {marketKpi?.completedOrders ?? 0} ออเดอร์
                    </p>
                  </div>
                  <div className="rounded-xl bg-sky-50 p-4">
                    <p className="text-xs font-medium text-sky-600">ออเดอร์รอจัดการ</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-sky-700">
                      {marketKpi?.pendingOrders ?? 0} ออเดอร์
                    </p>
                    <p className="mt-0.5 text-xs text-sky-600/70">จัดการได้ที่แท็บ ออเดอร์</p>
                  </div>
                </div>
              </CardContent>
            </Card>

          </TabsContent>

          {/* ============ Orders ============ */}
          <TabsContent value="orders" className="mt-6">
            {ordersError ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50/60 px-6 py-12 text-center">
                <AlertTriangle className="size-6 text-rose-400" />
                <p className="text-sm text-rose-600">{ordersError}</p>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void loadOrders()}>
                  <Loader2 className="size-3.5" /> ลองใหม่
                </Button>
              </div>
            ) : ordersLoading || ordersData === null ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-xl border border-slate-200 bg-white"
                  />
                ))}
              </div>
            ) : ordersData.length === 0 ? (
              <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-accent">
                  <ShoppingBag className="size-7 text-brand" />
                </span>
                <h2 className="mt-5 text-lg font-semibold text-slate-900">ยังไม่มีออเดอร์</h2>
                <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">
                  เมื่อลูกค้าสั่งซื้อจาก velshop ออเดอร์ทั้งหมดจะถูกรวมอยู่ที่นี่
                </p>
              </div>
            ) : (
              <>
              {/* Desktop: table */}
              <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5 text-slate-400">ออเดอร์ / ลูกค้า</TableHead>
                      <TableHead className="text-slate-400">วันที่</TableHead>
                      <TableHead className="text-slate-400">รายการ</TableHead>
                      <TableHead className="text-right text-slate-400">ยอดรวม</TableHead>
                      <TableHead className="pr-5 text-right text-slate-400">สถานะ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ordersData.map((order) => {
                      const meta =
                        ORDER_STATUS_META[order.status as CenterOrderStatus] ?? {
                          label: order.status,
                          badge: "bg-slate-100 text-slate-500 ring-slate-600/10 hover:bg-slate-100",
                          dot: "bg-slate-400",
                        };
                      return (
                        <TableRow key={order.id} className="hover:bg-slate-50/60">
                          <TableCell className="pl-5">
                            <p className="font-medium text-slate-900">
                              {order.orderNumber ?? shortOrderId(order.id)}
                            </p>
                            <p className="text-xs text-slate-400">
                              {order.shopName && <span className="font-medium text-slate-500">{order.shopName} · </span>}
                              {order.customerName} · {order.customerPhone}
                            </p>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm text-slate-600">{formatThaiDate(order.createdAt)}</p>
                            <p className="text-xs text-slate-400">{order.itemCount} ชิ้น</p>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-56 space-y-0.5">
                              {order.items.slice(0, 2).map((item) => (
                                <p key={item.id} className="truncate text-sm text-slate-600">
                                  {item.productName} × {item.quantity} {item.unit}
                                </p>
                              ))}
                              {order.items.length > 2 && (
                                <p className="text-xs text-slate-400">+{order.items.length - 2} รายการ</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <p className="font-semibold tabular-nums text-slate-900">
                              {formatBaht(order.total)}
                            </p>
                          </TableCell>
                          <TableCell className="pr-5 text-right">
                            {canManageOrders ? (
                              <Select
                                value={order.status}
                                onValueChange={(v) => handleOrderStatus(order.id, v)}
                                disabled={busyOrderId === order.id}
                              >
                                <SelectTrigger className="ml-auto h-9 w-36 rounded-md border-slate-200 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {statusOptions(order.status).map((s) => (
                                    <SelectItem key={s} value={s}>
                                      {(ORDER_STATUS_META[s as CenterOrderStatus] ?? { label: s }).label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Badge className={`gap-1.5 rounded-full ring-1 ring-inset ${meta.badge}`}>
                                <span className={`size-1.5 rounded-full ${meta.dot}`} />
                                {meta.label}
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile: app-like order cards */}
              <div className="space-y-3 md:hidden">
                {ordersData.map((order) => {
                  const meta =
                    ORDER_STATUS_META[order.status as CenterOrderStatus] ?? {
                      label: order.status,
                      badge: "bg-slate-100 text-slate-500 ring-slate-600/10 hover:bg-slate-100",
                      dot: "bg-slate-400",
                    };
                  return (
                    <div
                      key={order.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 transition-[transform,border-color,box-shadow,background-color] duration-200 active:scale-[0.99]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">
                            {order.orderNumber ?? shortOrderId(order.id)}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-400">
                            {order.shopName && <span className="font-medium text-slate-500">{order.shopName} · </span>}
                            {order.customerName} · {order.customerPhone}
                          </p>
                        </div>
                        {canManageOrders ? (
                          <Select
                            value={order.status}
                            onValueChange={(v) => handleOrderStatus(order.id, v)}
                            disabled={busyOrderId === order.id}
                          >
                            <SelectTrigger className="h-8 w-32 shrink-0 rounded-md border-slate-200 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {statusOptions(order.status).map((s) => (
                                <SelectItem key={s} value={s}>
                                  {(ORDER_STATUS_META[s as CenterOrderStatus] ?? { label: s }).label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge className={`shrink-0 gap-1.5 rounded-full ring-1 ring-inset ${meta.badge}`}>
                            <span className={`size-1.5 rounded-full ${meta.dot}`} />
                            {meta.label}
                          </Badge>
                        )}
                      </div>

                      <div className="mt-3 rounded-md bg-slate-50 px-3 py-2.5">
                        {order.items.slice(0, 2).map((item) => (
                          <p key={item.id} className="truncate text-sm text-slate-600">
                            {item.productName}{" "}
                            <span className="text-slate-400">× {item.quantity} {item.unit}</span>
                          </p>
                        ))}
                        {order.items.length > 2 && (
                          <p className="text-xs text-slate-400">+{order.items.length - 2} รายการ</p>
                        )}
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <p className="text-xs text-slate-400">
                          {formatThaiDate(order.createdAt)} · {order.itemCount} ชิ้น
                        </p>
                        <p className="font-bold tabular-nums text-slate-900">{formatBaht(order.total)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Next page of the platform order list. */}
              {ordersHasMore && (
                <div className="mt-6 flex justify-center">
                  <Button
                    variant="outline"
                    className="min-w-44 gap-1.5 rounded-md border-slate-200 text-slate-700"
                    onClick={() => void loadMoreOrders()}
                    disabled={ordersLoadingMore}
                  >
                    {ordersLoadingMore ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    {ordersLoadingMore ? "กำลังโหลดเพิ่มเติม..." : "โหลดออเดอร์เพิ่มเติม"}
                  </Button>
                </div>
              )}
              </>
            )}
            {!canManageOrders && (
              <p className="mt-4 text-xs text-slate-400">
                โหมดพนักงาน: ดูข้อมูลได้ แต่เปลี่ยนสถานะออเดอร์ได้เฉพาะผู้ดูแลและเจ้าของบริษัท
              </p>
            )}
          </TabsContent>

          {/* Intelligence (restock prediction) was removed 2026-11-09 — the
              company does not use it, and a tab nobody opens is a maintenance
              surface with no user. The learned-cycle data it read is still on the
              seller side (reorder), which is where restocking actually happens. */}

          <TabsContent value="products" className="mt-6">
            <div className="mb-4 flex items-center gap-2 text-sm text-slate-500">
              <Package className="size-4 text-brand" />
              ตรวจสอบสินค้าที่พ่อค้าส่งมา — อนุมัติแล้วจะแสดงที่หน้าร้าน velshop
            </div>
            <ProductModerationQueue />
          </TabsContent>

          {/* ============ Sellers — application review (Neon, spec §36) ============ */}
          <TabsContent value="sellers" className="mt-6">
            <div className="mb-4 flex items-center gap-2 text-sm text-slate-500">
              <Store className="size-4 text-brand" />
              ตรวจสอบใบสมัครและการยืนยันร้านค้า
            </div>
            <SellerVerificationQueue />
          </TabsContent>

          {/* ============ Categories (admin/owner) ============ */}
          {canSee("categories") && (
            <TabsContent value="categories" className="mt-6">
              <CategoriesManagement />
            </TabsContent>
          )}
          {/* ============ People (spec 9-11, 42) ==========================
              Staff and customers are TWO separate lists, filtered server-side
              by the real users.role values (GET /api/admin/users?segment=...).
              Employee management stays owner-only — the API enforces it; this
              UI only reflects it. */}
          {canSee("staff") && (
            <TabsContent value="staff" className="mt-6">
              {peopleError && (
                <div className="mb-4 flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-center gap-2 text-sm text-red-700">
                    <AlertTriangle className="size-4 shrink-0" />
                    โหลดรายชื่อผู้ใช้ไม่สำเร็จ: {peopleError}
                  </p>
                  <Button variant="outline" size="sm" className="shrink-0 rounded-md" onClick={() => void loadPeople()}>
                    ลองใหม่
                  </Button>
                </div>
              )}

              {canSeeDirectory ? (
              <Tabs value={peopleSegment} onValueChange={(v) => setPeopleSegment(v as "staff" | "customer")}>
                <TabsList className="w-full justify-start overflow-x-auto rounded-lg border border-slate-200 bg-white p-1 sm:w-auto">
                  <TabsTrigger value="staff" className="gap-1.5 rounded-md">
                    <ShieldCheck className="size-4" /> พนักงาน
                    <span className="rounded-full bg-slate-100 px-1.5 text-2xs font-bold text-slate-600">{peopleCounts.staff}</span>
                  </TabsTrigger>
                  <TabsTrigger value="customer" className="gap-1.5 rounded-md">
                    <ShoppingBag className="size-4" /> ลูกค้า
                    <span className="rounded-full bg-slate-100 px-1.5 text-2xs font-bold text-slate-600">{peopleCounts.customer}</span>
                  </TabsTrigger>
                </TabsList>

                {/* ---------- Staff accounts (owner only) ---------- */}
                <TabsContent value="staff" className="mt-4">
                  {isOwner ? (
                    <>
              <Card className="mb-4 max-w-2xl border-slate-200 shadow-none">
                <CardContent className="pt-5">
                  <p className="flex items-center gap-2 text-sm text-slate-600">
                    <Crown className="size-4 text-amber-500" />
                    เฉพาะเจ้าของบริษัทเท่านั้นที่จัดการสิทธิ์พนักงาน — admin/พนักงานดูข้อมูลได้แต่แตะตรงนี้ไม่ได้
                  </p>
                </CardContent>
              </Card>

              {/* Employee accounts: create / reset password / permissions (spec §9–§11, §42) */}
              <EmployeeManager />

              <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
                <Table className="min-w-[560px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5 text-slate-400">พนักงาน</TableHead>
                      <TableHead className="text-slate-400">บทบาท</TableHead>
                      <TableHead className="text-slate-400">ฝ่าย</TableHead>
                      <TableHead className="pr-5 text-right text-slate-400">สิทธิ์</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(staffUsers ?? []).map((u: any) => {
                      const role = u.role ?? "customer";
                      const meta =
                        ROLE_META[role as keyof typeof ROLE_META] ?? ROLE_META.customer;
                      const isSelf = u._id === user?._id;
                      return (
                        <TableRow key={u._id} className="hover:bg-slate-50/60">
                          <TableCell className="pl-5">
                            <p className="font-medium text-slate-900">
                              {u.name || "ผู้ใช้ที่ยังไม่ตั้งชื่อ"}
                              {isSelf && <span className="ml-1.5 text-xs text-slate-400">(คุณ)</span>}
                            </p>
                            <p className="text-xs text-slate-400">{u.email ?? "บัญชีผู้เยี่ยมชม"}</p>
                          </TableCell>
                          <TableCell>
                            {isSelf ? (
                              <Badge className={`gap-1 rounded-full ring-1 ring-inset ${meta.badge}`}>
                                {role === "owner" && <Crown className="size-3" />}
                                {role === "admin" && <BadgeCheck className="size-3" />}
                                {meta.label}
                              </Badge>
                            ) : (
                              <Select
                                value={role}
                                onValueChange={(v) =>
                                  handleSetUserAccess(
                                    u._id,
                                    v as "customer" | "seller" | "admin" | "owner" | "staff",
                                    u.department,
                                  )
                                }
                                disabled={busyUserId === u._id}
                              >
                                <SelectTrigger className="h-9 w-40 rounded-md border-slate-200 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="customer">ลูกค้า</SelectItem>
                                  <SelectItem value="seller">พ่อค้า / ร้านค้า</SelectItem>
                                  <SelectItem value="staff">พนักงาน (ดูข้อมูล)</SelectItem>
                                  <SelectItem value="admin">ผู้ดูแลฝ่าย</SelectItem>
                                  <SelectItem value="owner">เจ้าของบริษัท</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell>
                            {isSelf ? (
                              <span className="text-sm text-slate-400">
                                {u.department
                                  ? DEPARTMENT_LABEL[u.department] ?? u.department
                                  : "—"}
                              </span>
                            ) : (
                              <Select
                                value={u.department ?? "general"}
                                onValueChange={(v) =>
                                  handleSetUserAccess(u._id, role, v)
                                }
                                disabled={busyUserId === u._id}
                              >
                                <SelectTrigger className="h-9 w-40 rounded-md border-slate-200 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {DEPARTMENTS.map((d) => (
                                    <SelectItem key={d.id} value={d.id}>
                                      {d.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell className="pr-5 text-right">
                            <Badge
                              className={`gap-1 rounded-full ring-1 ring-inset ${meta.badge}`}
                            >
                              {meta.label}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile: app-like staff cards */}
              <div className="space-y-3 md:hidden">
                {(staffUsers ?? []).map((u: any) => {
                  const role = u.role ?? "customer";
                  const meta =
                    ROLE_META[role as keyof typeof ROLE_META] ?? ROLE_META.customer;
                  const isSelf = u._id === user?._id;
                  return (
                    <div
                      key={u._id}
                      className="rounded-xl border border-slate-200 bg-white p-4 transition-[transform,border-color,box-shadow,background-color] duration-200 active:scale-[0.99]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {u.name || "ผู้ใช้ที่ยังไม่ตั้งชื่อ"}
                            {isSelf && <span className="ml-1.5 text-xs text-slate-400">(คุณ)</span>}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-400">{u.email ?? "บัญชีผู้เยี่ยมชม"}</p>
                        </div>
                        <Badge className={`shrink-0 gap-1 rounded-full ring-1 ring-inset ${meta.badge}`}>
                          {role === "owner" && <Crown className="size-3" />}
                          {role === "admin" && <BadgeCheck className="size-3" />}
                          {meta.label}
                        </Badge>
                      </div>
                      {!isSelf && (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <Select
                            value={role}
                            onValueChange={(v) =>
                              handleSetUserAccess(
                                u._id,
                                v as "customer" | "seller" | "admin" | "owner" | "staff",
                                u.department,
                              )
                            }
                            disabled={busyUserId === u._id}
                          >
                            <SelectTrigger className="h-10 w-full rounded-md border-slate-200 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="customer">ลูกค้า</SelectItem>
                              <SelectItem value="seller">พ่อค้า / ร้านค้า</SelectItem>
                              <SelectItem value="staff">พนักงาน (ดูข้อมูล)</SelectItem>
                              <SelectItem value="admin">ผู้ดูแลฝ่าย</SelectItem>
                              <SelectItem value="owner">เจ้าของบริษัท</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select
                            value={u.department ?? "general"}
                            onValueChange={(v) => handleSetUserAccess(u._id, role, v)}
                            disabled={busyUserId === u._id}
                          >
                            <SelectTrigger className="h-10 w-full rounded-md border-slate-200 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DEPARTMENTS.map((d) => (
                                <SelectItem key={d.id} value={d.id}>
                                  {d.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
                      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
                        <Users className="size-3.5 shrink-0 text-brand" />
                        พนักงาน (staff) ดูตัวเลขธุรกิจได้แต่แตะข้อมูลไม่ได้ · ผู้ดูแลฝ่าย (admin) จัดการข้อมูลได้แต่จัดการพนักงานไม่ได้
                      </p>
                    </>
                  ) : canReadEmployees ? (
                    <>
                      <Card className="mb-4 max-w-2xl border-slate-200 shadow-none">
                        <CardContent className="pt-5">
                          <p className="flex items-center gap-2 text-sm text-slate-600">
                            <Crown className="size-4 shrink-0 text-amber-500" />
                            ดูบัญชีพนักงานได้ตามสิทธิ์ staff.manage — การสร้างบัญชี แก้ไขสิทธิ์ และรีเซ็ตรหัสผ่านเป็นสิทธิ์ของเจ้าของบริษัทเท่านั้น
                          </p>
                        </CardContent>
                      </Card>
                      <EmployeeManager readOnly />
                    </>
                  ) : (
                    <Card className="border-slate-200 shadow-none">
                      <CardContent className="pt-5">
                        <p className="flex items-center gap-2 text-sm text-slate-600">
                          <Crown className="size-4 shrink-0 text-amber-500" />
                          การจัดการบัญชีและสิทธิ์พนักงานเป็นสิทธิ์ของเจ้าของบริษัทเท่านั้น
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* ---------- Customers ---------- */}
                <TabsContent value="customer" className="mt-4">
                  <Card className="gap-0 border-slate-200 shadow-none">
                    <CardHeader className="flex-col items-start gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <ShoppingBag className="size-4 text-brand" />
                          บัญชีลูกค้า
                        </CardTitle>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          ลูกค้า {peopleCounts.customer} บัญชี · ผู้ขาย {peopleCounts.seller} บัญชี — แยกตามบทบาทจริงในฐานข้อมูล
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 gap-1.5 rounded-md border-slate-200 text-slate-600"
                        onClick={() => void loadPeople()}
                      >
                        <RefreshCw className={`size-3.5 ${customerUsers === null ? "animate-spin" : ""}`} />
                        รีเฟรช
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          value={customerSearch}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                          placeholder="ค้นหาชื่อหรืออีเมลลูกค้า..."
                          className="rounded-md pl-9"
                        />
                      </div>

                      {customerUsers === null ? (
                        <div className="space-y-2">
                          {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="h-14 animate-pulse rounded-xl border border-slate-200 bg-white" />
                          ))}
                        </div>
                      ) : filteredCustomers.length === 0 ? (
                        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent">
                            <ShoppingBag className="size-6 text-brand" />
                          </span>
                          <p className="mt-4 text-sm font-semibold text-slate-900">
                            {customerSearch ? "ไม่พบลูกค้าที่ค้นหา" : "ยังไม่มีบัญชีลูกค้า"}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {customerSearch ? "ลองใช้คำค้นอื่น" : "บัญชีลูกค้าจะปรากฏที่นี่เมื่อมีผู้สมัครใช้งาน velshop"}
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
                            <Table className="min-w-[620px]">
                              <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                  <TableHead className="pl-4 text-slate-400">ลูกค้า</TableHead>
                                  <TableHead className="text-slate-400">อีเมล</TableHead>
                                  <TableHead className="text-slate-400">สมัครเมื่อ</TableHead>
                                  <TableHead className="pr-4 text-right text-slate-400">สถานะ</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {filteredCustomers.map((c) => (
                                  <TableRow key={c._id} className="hover:bg-slate-50/60">
                                    <TableCell className="pl-4">
                                      <p className="font-medium text-slate-900">{c.name || "ลูกค้าที่ยังไม่ตั้งชื่อ"}</p>
                                      <p className="text-xs text-slate-400">#{c._id.slice(0, 8)}</p>
                                    </TableCell>
                                    <TableCell className="text-sm text-slate-600">{c.email ?? "—"}</TableCell>
                                    <TableCell className="text-sm text-slate-600">{formatThaiDate(c.createdAt)}</TableCell>
                                    <TableCell className="pr-4 text-right">
                                      <Badge className={c.status === "active" ? "rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15" : "rounded-full bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/15"}>
                                        {c.status === "active" ? "ใช้งาน" : c.status}
                                      </Badge>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>

                          <div className="space-y-2 md:hidden">
                            {filteredCustomers.map((c) => (
                              <div key={c._id} className="rounded-xl border border-slate-200 bg-white p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-slate-900">{c.name || "ลูกค้าที่ยังไม่ตั้งชื่อ"}</p>
                                    <p className="mt-0.5 truncate text-xs text-slate-400">{c.email ?? "—"}</p>
                                  </div>
                                  <Badge className={c.status === "active" ? "shrink-0 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15" : "shrink-0 rounded-full bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/15"}>
                                    {c.status === "active" ? "ใช้งาน" : c.status}
                                  </Badge>
                                </div>
                                <p className="mt-2 text-2xs text-slate-400">สมัครเมื่อ {formatThaiDate(c.createdAt)}</p>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
              ) : (
                /* `staff.manage` without `users.manage`: the employee roster on
                   its own — the directory endpoint would be a guaranteed 403. */
                <EmployeeManager readOnly={!isOwner} />
              )}
            </TabsContent>
          )}

          {/* ============ Audit Logs (spec §44) ============ */}
          <AuditLogTab />

          {/* ============ Late / unrecordable payments (audit HIGH #5) ====
              Money Stripe captured that the order lifecycle could not settle.
              Deliberately offers NO refund and NO reopen control: those are
              business decisions this platform has not documented, and money
              still moves only through the existing operator refund route. */}
          <PaymentIncidentTab />

          {/* ============ Multi-carrier tracking management ============ */}
          {canSee("tracking") && (
            <TabsContent value="tracking" className="mt-6">
              <TrackingTab />
            </TabsContent>
          )}

          {/* ============ Marketing (banner contract v2) ==================
              Homepage content management lives here — deliberately NOT inside
              Settings. Banners write platform_settings via
              PUT /api/admin/announcements, which enforces settings.manage. */}
          {canSee("marketing") && (
            <TabsContent value="marketing" className="mt-6">
              <MarketingBanners />
            </TabsContent>
          )}

          {/* ============ Company / System Settings =========================
              VelCenter is the company control plane, so this screen configures
              the platform/company — not one shop. Editable values persist to
              Neon `platform_settings` and every change is audit-logged
              server-side. Read-only values come from the backend component that
              actually owns them (commission policy, upload limits) so there is
              never a second source of truth for money or media. */}
          {canSee("settings") && (
            <TabsContent value="settings" className="mt-6">
              {settingsError && (
                <div className="mb-4 flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-center gap-2 text-sm text-red-700">
                    <AlertTriangle className="size-4 shrink-0" />
                    โหลดการตั้งค่าไม่สำเร็จ: {settingsError}
                  </p>
                  <Button variant="outline" size="sm" className="shrink-0 rounded-md" onClick={() => void loadSettings()}>
                    ลองใหม่
                  </Button>
                </div>
              )}

              <div className="grid gap-5 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
                {/* Section nav — wrapping chip grid on mobile (nothing scrolls
                    sideways or gets clipped), sidebar on desktop. min-h-11 keeps
                    every section a 44px touch target. */}
                <nav aria-label="หมวดการตั้งค่า" className="lg:sticky lg:top-24 lg:self-start">
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:flex lg:flex-col lg:gap-1">
                    {SETTINGS_SECTIONS.map((section) => {
                      const Icon = section.icon;
                      const active = settingsSection === section.id;
                      return (
                        <button
                          key={section.id}
                          type="button"
                          onClick={() => setSettingsSection(section.id)}
                          aria-current={active ? "page" : undefined}
                          className={`flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors lg:w-full ${
                            active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          <Icon className="size-4 shrink-0" />
                          <span className="min-w-0">{section.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </nav>

                <div className="min-w-0 space-y-5">
                  {/* ---------- Company / platform identity ---------- */}
                  {settingsSection === "company" && (
                    <Card className="border-slate-200 shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Store className="size-4 text-brand" />
                          ข้อมูลบริษัท / แพลตฟอร์ม
                        </CardTitle>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          Identity ของ Velnox Marketplace ที่แสดงบน velshop — บันทึกแล้วมีผลทันที
                          และทุกการเปลี่ยนแปลงถูกบันทึกใน Audit Logs
                        </p>
                      </CardHeader>
                      <CardContent>
                        <form onSubmit={handleSaveSettings} className="grid gap-4">
                          <div className="grid gap-2">
                            <Label htmlFor="settings-name">ชื่อแพลตฟอร์ม / ร้านค้า</Label>
                            <Input
                              id="settings-name"
                              value={form.shopName}
                              onChange={(e) => setForm((f) => ({ ...f, shopName: e.target.value }))}
                              placeholder="เช่น Velnox Marketplace"
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="settings-tagline">คำโปรย / tagline</Label>
                            <Input
                              id="settings-tagline"
                              value={form.tagline}
                              onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
                              placeholder="ซื้อขายของจริง · ปลีกและส่ง ในที่เดียว"
                            />
                          </div>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="grid gap-2">
                              <Label htmlFor="settings-phone">เบอร์โทรติดต่อ</Label>
                              <Input
                                id="settings-phone"
                                value={form.phone}
                                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                                placeholder="081-234-5678"
                              />
                            </div>
                            <div className="grid gap-2">
                              <Label htmlFor="settings-announcement">ประกาศหน้าร้านค้า (ShopDetail)</Label>
                              <Input
                                id="settings-announcement"
                                value={form.announcement}
                                onChange={(e) => setForm((f) => ({ ...f, announcement: e.target.value }))}
                                placeholder="เช่น สินค้าใหม่เข้าคลังแล้ว!"
                              />
                              <p className="text-2xs text-slate-400">
                                ประกาศนี้แสดงในหน้าร้านค้าแต่ละร้านเท่านั้น — แบนเนอร์หน้าแรกอยู่ที่แท็บ การตลาด
                              </p>
                            </div>
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="settings-address">ที่อยู่บริษัท / ที่อยู่ร้าน</Label>
                            <Textarea
                              id="settings-address"
                              value={form.address}
                              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                              placeholder="ที่อยู่สำหรับรับสินค้า / นัดรับ"
                              rows={2}
                            />
                          </div>
                          <Button
                            type="submit"
                            className="w-fit gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
                            disabled={savingSettings || settings === null}
                          >
                            {savingSettings ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                            บันทึกการตั้งค่า
                          </Button>
                        </form>
                      </CardContent>
                    </Card>
                  )}

                  {/* ---------- Marketplace behaviour ---------- */}
                  {settingsSection === "marketplace" && (
                    <Card className="border-slate-200 shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Package className="size-4 text-brand" />
                          ตลาด & การอนุมัติสินค้า
                        </CardTitle>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          ควบคุมว่าสินค้าที่ผู้ขายส่งเข้าตลาดต้องผ่านการอนุมัติหรือไม่
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-3">
                          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-emerald-300">
                            <input type="radio" name="approval-mode" value="manual" checked={approvalMode === "manual"} onChange={() => handleApprovalModeChange("manual")} disabled={savingApproval} className="mt-0.5" />
                            <div>
                              <span className="text-sm font-medium text-slate-900">อนุมัติด้วยมือ</span>
                              <p className="text-xs text-slate-500">สินค้าทุกชิ้นต้องได้รับการตรวจสอบและอนุมัติจากผู้ดูแลก่อนแสดงบน VelShop</p>
                            </div>
                          </label>
                          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-emerald-300">
                            <input type="radio" name="approval-mode" value="auto" checked={approvalMode === "auto"} onChange={() => handleApprovalModeChange("auto")} disabled={savingApproval} className="mt-0.5" />
                            <div>
                              <span className="text-sm font-medium text-slate-900">อนุมัติอัตโนมัติ</span>
                              <p className="text-xs text-slate-500">สินค้าจะได้รับการอนุมัติและแสดงบน VelShop ทันทีหลังผ่านการตรวจสอบข้อมูล</p>
                            </div>
                          </label>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
                          ระบบยืนยันตัวตนของ Velnox เป็นแบบเดียว: การยืนยันตัวตนของผู้ขาย/ร้านค้า
                          {settingsMeta?.moderation?.productVerificationEnabled === false
                            ? " — ไม่มีระบบยืนยันสินค้าแยกรายชิ้น ป้าย V จึงมาจากสถานะการยืนยันของผู้ขายเท่านั้น"
                            : ""}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* ---------- Seller commission (read-only, real policy) ---------- */}
                  {settingsSection === "commission" && (
                    <Card className="border-slate-200 shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Coins className="size-4 text-brand" />
                          ค่าธรรมเนียมผู้ขาย (Seller & Commission)
                        </CardTitle>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          นโยบายการเงินที่ engine คำนวณรายได้ของผู้ขายใช้จริง — แสดงแบบอ่านอย่างเดียว
                          เพื่อไม่ให้มีแหล่งความจริงซ้อนกัน
                        </p>
                      </CardHeader>
                      <CardContent>
                        {settingsMeta?.commission ? (
                          <>
                            <div className="grid gap-3 sm:grid-cols-3">
                              <div className="rounded-xl border border-slate-200 bg-white p-4">
                                <p className="text-xs text-slate-400">ค่าธรรมเนียมผู้ขาย</p>
                                <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                                  {((settingsMeta.commission.sellerRate ?? 0) * 100).toFixed(1)}%
                                </p>
                                <p className="mt-0.5 text-2xs text-slate-400">หักจากยอดขายแต่ละรายการ</p>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-white p-4">
                                <p className="text-xs text-slate-400">ความคุ้มครองการคืนสินค้า</p>
                                <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                                  {((settingsMeta.commission.returnCoverage ?? 0) * 100).toFixed(0)}%
                                </p>
                                <p className="mt-0.5 text-2xs text-slate-400">ของยอดขาย ครอบคลุมด้วยค่าธรรมเนียม</p>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-white p-4">
                                <p className="text-xs text-slate-400">สกุลเงิน</p>
                                <p className="mt-1 text-2xl font-bold text-slate-900">{settingsMeta.commission.currency ?? "THB"}</p>
                                <p className="mt-0.5 text-2xs text-slate-400">สกุลเงินที่ระบบใช้คำนวณ</p>
                              </div>
                            </div>
                            <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
                              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                              ค่าธรรมเนียมถูกกำหนดในระดับแพลตฟอร์ม (โค้ด/คอนฟิกของผู้ให้บริการ)
                              จึงแก้จากหน้านี้ไม่ได้ — ป้องกันไม่ให้ยอดเงินของผู้ขายผิดพลาดจากการตั้งค่าโดยไม่ตั้งใจ
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-slate-400">กำลังโหลดนโยบายค่าธรรมเนียม...</p>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* ---------- Localization ---------- */}
                  {settingsSection === "localization" && (
                    <Card className="border-slate-200 shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Globe className="size-4 text-brand" />
                          ภาษา & ท้องถิ่น
                        </CardTitle>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          ภาษาที่แพลตฟอร์มรองรับ (แหล่งความจริงเดียว: shared i18n config)
                        </p>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {SUPPORTED_LANGUAGES.map((lang) => (
                            <div key={lang.code} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-900">{lang.label}</p>
                                <p className="font-mono text-xs uppercase text-slate-400">{lang.code}</p>
                              </div>
                              {lang.code === DEFAULT_LANGUAGE && (
                                <Badge className="shrink-0 gap-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15">
                                  <BadgeCheck className="size-3" />
                                  ค่าเริ่มต้น
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                        <p className="mt-4 text-xs leading-5 text-slate-400">
                          ภาษาถูกเก็บเป็นคีย์ในฐานข้อมูล (categories.names, platform_settings) — เพิ่มภาษาใหม่ต้องมี locale file ใน shared i18n
                        </p>
                      </CardContent>
                    </Card>
                  )}

                  {/* ---------- Media ---------- */}
                  {settingsSection === "media" && (
                    <Card className="border-slate-200 shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <ImageIcon className="size-4 text-brand" />
                          ไฟล์ & สื่อ (Media)
                        </CardTitle>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          ข้อจำกัดการอัปโหลดที่ backend บังคับใช้จริง (Cloudflare R2)
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <p className="text-xs text-slate-400">ขนาดไฟล์สูงสุด</p>
                            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                              {settingsMeta?.media?.maxUploadBytes
                                ? `${Math.round(settingsMeta.media.maxUploadBytes / (1024 * 1024))} MB`
                                : "—"}
                            </p>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <p className="text-xs text-slate-400">ประเภทไฟล์ที่อนุญาต</p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {(settingsMeta?.media?.allowedTypes ?? []).map((type) => (
                                <Badge key={type} className="rounded-full bg-slate-100 text-2xs text-slate-600 ring-1 ring-inset ring-slate-600/10">
                                  {type.replace("image/", "")}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                        <p className="text-xs leading-5 text-slate-400">
                          ไฟล์ถูกเก็บแบบ private บน R2 — หลักฐานการยืนยันตัวตนเข้าถึงได้เฉพาะผู้ตรวจสอบผ่าน signed URL อายุสั้น
                        </p>
                      </CardContent>
                    </Card>
                  )}

                  {/* ---------- Access / permissions ---------- */}
                  {settingsSection === "access" && (
                    <Card className="border-slate-200 shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <KeyRound className="size-4 text-brand" />
                          สิทธิ์การเข้าถึง (Permissions)
                        </CardTitle>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          แคตตาล็อกสิทธิ์ที่ระบบรู้จัก — การมอบสิทธิ์ทำได้ที่แท็บ “ผู้ใช้ & ลูกค้า” (เจ้าของบริษัทเท่านั้น)
                        </p>
                      </CardHeader>
                      <CardContent>
                        {isOwner ? (
                          permissionCatalog.length === 0 ? (
                            <p className="text-sm text-slate-400">กำลังโหลดรายการสิทธิ์...</p>
                          ) : (
                            <ul className="grid gap-2 sm:grid-cols-2">
                              {permissionCatalog.map((perm) => (
                                <li key={perm.code} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                                  <p className="text-sm font-medium text-slate-900">{perm.label}</p>
                                  <p className="mt-0.5 text-xs text-slate-400">{perm.description}</p>
                                  <p className="mt-1 font-mono text-2xs text-slate-300">{perm.code}</p>
                                </li>
                              ))}
                            </ul>
                          )
                        ) : (
                          <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
                            การจัดการสิทธิ์พนักงานเป็นสิทธิ์ของเจ้าของบริษัทเท่านั้น
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </main>

{/* Mobile bottom nav removed — VelCenter uses top tab strip */}
    </div>
  );
}
