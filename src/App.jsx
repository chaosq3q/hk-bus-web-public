import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { fetchEtaDb, fetchEtas } from "hk-bus-eta";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  Input,
  SectionCard,
  SystemStatusPanel,
  Textarea,
  ToastProvider,
  useToast,
} from "idk-ui";
import {
  FaArrowLeft,
  FaBusSimple,
  FaClock,
  FaCode,
  FaDatabase,
  FaLocationDot,
  FaMagnifyingGlass,
  FaPalette,
  FaPlus,
  FaTrash,
  FaXmark,
} from "react-icons/fa6";
import { DEFAULT_LANGUAGE, translate } from "./i18n";

const BUS_REFRESH_INTERVAL = 30_000;
const BUS_STORAGE_KEY = "hk-bus-web.watch-list";
const BUS_GROUP_STORAGE_KEY = "hk-bus-web.watch-groups";
const THEME_STORAGE_KEY = "hk-bus-web.theme";
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_INITIAL_LIMIT = 20;
const SEARCH_LOAD_MORE_STEP = 20;
const THEME_OPTIONS = [
  {
    value: "origin",
    label: "Origin",
    description: "Warm station board colors with the current HK Bus Web look.",
  },
  {
    value: "toy-story",
    label: "Toy Story",
    description: "Playful sky-blue, yellow, and red accents with a brighter toy-box feel.",
  },
  {
    value: "black",
    label: "Black",
    description: "High-contrast dark surfaces with neon-like route highlights.",
  },
];
const SEARCH_MODE_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "routeNumber", label: "巴士號碼" },
  { value: "station", label: "站名" },
  { value: "routeId", label: "routeId" },
];
const COMPANY_FILTER_OPTIONS = [
  { value: "kmb", label: "KMB" },
  { value: "ctb", label: "CTB" },
  { value: "gmb", label: "GMB" },
  { value: "nlb", label: "NLB" },
  { value: "lwb", label: "LWB" },
  { value: "mtrb", label: "MTRB" },
];
const COMPANY_ALIASES = {
  kmb: ["kmb", "kowloonmotorbus"],
  ctb: ["ctb", "citybus"],
  nwfb: ["nwfb"],
  nlb: ["nlb", "newlantaobus"],
  lwb: ["lwb", "longwin"],
  mtrb: ["mtrb", "mtrbus"],
  lrtfeeder: ["lrtfeeder", "feeder"],
  gmb: ["gmb", "minibus", "greenminibus"],
  sunferry: ["sunferry"],
};

function SectionTitleWithIcon({ icon, children }) {
  return (
    <span className="section-title-with-icon">
      <span className="section-title-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </span>
  );
}

let etaDbPromise;

function getEtaDb() {
  if (!etaDbPromise) {
    etaDbPromise = fetchEtaDb();
  }

  return etaDbPromise;
}

function normalizeSearchText(value) {
  return value.trim().toLowerCase();
}

function formatCompanyLabel(company) {
  return String(company ?? "").toUpperCase();
}

function getPrimaryCompany(companies) {
  const normalized = Array.isArray(companies)
    ? companies.map((company) => normalizeSearchText(company)).filter(Boolean)
    : [];

  if (normalized.includes("kmb")) {
    return "kmb";
  }

  if (normalized.includes("gmb")) {
    return "gmb";
  }

  if (normalized.includes("ctb")) {
    return "ctb";
  }

  return normalized[0] ?? "";
}

function getCompanyThemeClass(company) {
  switch (normalizeSearchText(company)) {
    case "kmb":
      return "company-theme-kmb";
    case "gmb":
      return "company-theme-gmb";
    case "ctb":
      return "company-theme-ctb";
    default:
      return "";
  }
}

function getMatchScore(text, query) {
  const normalizedText = normalizeSearchText(text);
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedText || !normalizedQuery) {
    return 0;
  }

  if (normalizedText === normalizedQuery) {
    return 3;
  }

  if (normalizedText.startsWith(normalizedQuery)) {
    return 2;
  }

  if (normalizedText.includes(normalizedQuery)) {
    return 1;
  }

  return 0;
}

function normalizeStopSearchText(value) {
  return normalizeSearchText(
    value
      .replace(/\s*\([^)]*\)/g, "")
      .replace(/\s*（[^）]*）/g, "")
      .replace(/\s+/g, " "),
  );
}

function parseSearchQuery(query) {
  const tokens = query
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const companyFilters = [];
  const searchTokens = [];

  tokens.forEach((token) => {
    const normalizedToken = normalizeSearchText(token);
    const matchedCompany = Object.entries(COMPANY_ALIASES).find(([, aliases]) =>
      aliases.some((alias) => normalizeSearchText(alias) === normalizedToken),
    )?.[0];

    if (matchedCompany) {
      companyFilters.push(matchedCompany);
      return;
    }

    searchTokens.push(token);
  });

  return {
    companyFilters: [...new Set(companyFilters)],
    searchText: searchTokens.join(" ").trim(),
  };
}

function getWatchKey(watch) {
  return [watch.routeId, watch.company ?? "", watch.seq].join("::");
}

function getLocalizedValue(record, language, fallback = "-") {
  if (!record || typeof record !== "object") {
    return fallback;
  }

  return record[language] ?? record.en ?? record.zh ?? fallback;
}

function formatClock(etaString, language) {
  return new Date(etaString).toLocaleTimeString(
    language === "zh" ? "zh-HK" : "en-HK",
    { hour: "2-digit", minute: "2-digit" },
  );
}

function formatMinutes(etaString, language, t) {
  const diffMs = new Date(etaString).getTime() - Date.now();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));

  if (diffMinutes <= 0) {
    return t("bus.now");
  }

  return t("bus.minute", { count: diffMinutes, language });
}

function getNextArrivalMinutes(etaString) {
  if (!etaString) {
    return null;
  }

  const etaTime = new Date(etaString).getTime();
  if (!Number.isFinite(etaTime)) {
    return null;
  }

  return Math.max(0, Math.round((etaTime - Date.now()) / 60000));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mixChannel(start, end, ratio) {
  return Math.round(start + (end - start) * ratio);
}

function mixRgb(start, end, ratio) {
  return `rgb(${mixChannel(start[0], end[0], ratio)} ${mixChannel(start[1], end[1], ratio)} ${mixChannel(start[2], end[2], ratio)})`;
}

function getHeatmapLuminance(rgb) {
  const matches = rgb.match(/\d+/g);
  if (!matches || matches.length < 3) {
    return 0.5;
  }

  const [red, green, blue] = matches.map((value) => Number(value) / 255);
  const transform = (channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  const linearRed = transform(red);
  const linearGreen = transform(green);
  const linearBlue = transform(blue);

  return 0.2126 * linearRed + 0.7152 * linearGreen + 0.0722 * linearBlue;
}

const GROUP_HEATMAP_PALETTES = {
  kmb: {
    deep: [139, 29, 29],
    light: [251, 226, 226],
  },
  ctb: {
    deep: [153, 92, 0],
    light: [255, 240, 208],
  },
  gmb: {
    deep: [14, 116, 110],
    light: [224, 250, 246],
  },
  default: {
    deep: [73, 85, 101],
    light: [234, 238, 243],
  },
};

function getGroupHeatmapPalette(company) {
  return GROUP_HEATMAP_PALETTES[normalizeSearchText(company)] ?? GROUP_HEATMAP_PALETTES.default;
}

function buildGroupChipStyle(minutes, minMinutes, maxMinutes, company) {
  const palette = getGroupHeatmapPalette(company);

  if (minutes == null) {
    return {
      "--group-chip-bg": "var(--surface-soft-strong)",
      "--group-chip-color": "var(--muted-foreground)",
      "--group-chip-border": "rgba(97, 71, 48, 0.12)",
    };
  }

  const range = Math.max(maxMinutes - minMinutes, 1);
  const ratio = clamp((minutes - minMinutes) / range, 0, 1);
  const bg = mixRgb(palette.deep, palette.light, ratio);
  const luminance = getHeatmapLuminance(bg);
  const textColor = luminance < 0.52 ? "#f8fafc" : "#1f2a37";
  const borderColor = mixRgb(palette.deep, palette.light, clamp(ratio * 0.75 + 0.08, 0, 1));

  return {
    "--group-chip-bg": bg,
    "--group-chip-color": textColor,
    "--group-chip-border": borderColor,
  };
}

function getGroupChipScale(isActive) {
  return isActive ? 1.1 : 0.94;
}

function matchesRouteQuery(routeId, route, query) {
  const queryText = normalizeSearchText(query);

  if (!queryText) {
    return false;
  }

  const fields = [
    routeId,
    route.route,
    route.orig?.en,
    route.orig?.zh,
    route.dest?.en,
    route.dest?.zh,
  ];

  return fields.some((field) => normalizeSearchText(field ?? "").includes(queryText));
}

function matchesSearchMode(routeId, route, query, mode) {
  const queryText = normalizeSearchText(query);

  if (!queryText) {
    return false;
  }

  const modeFields = {
    routeNumber: [route.route],
    station: [route.orig?.en, route.orig?.zh, route.dest?.en, route.dest?.zh],
    routeId: [routeId],
  };

  if (mode === "all") {
    return matchesRouteQuery(routeId, route, query);
  }

  return (modeFields[mode] ?? []).some((field) =>
    normalizeSearchText(field ?? "").includes(queryText),
  );
}

function searchEtaRoutes(etaDb, query, language, searchMode = "all", selectedCompanyFilters = []) {
  const { companyFilters, searchText } = parseSearchQuery(query);
  const activeCompanyFilters = [...new Set([...companyFilters, ...selectedCompanyFilters])];
  const queryText = normalizeSearchText(searchText);

  return Object.entries(etaDb.routeList)
    .map(([routeId, route]) => {
      const routeCompanies = (route.co ?? []).map((company) => normalizeSearchText(company));
      const companyMatches =
        activeCompanyFilters.length === 0 ||
        activeCompanyFilters.some((companyFilter) => routeCompanies.includes(normalizeSearchText(companyFilter)));

      if (!companyMatches) {
        return null;
      }

      const routeMatches = queryText ? matchesSearchMode(routeId, route, searchText, searchMode) : false;
      const routeFullName = [
        getLocalizedValue(route.orig, language, ""),
        getLocalizedValue(route.dest, language, ""),
      ]
        .filter(Boolean)
        .join(" ");
      const routeNumberScore = getMatchScore(route.route, searchText);
      const routeFullNameScore = getMatchScore(routeFullName, searchText);
      const stopsByCompany = Object.entries(route.stops ?? {})
        .filter(([company]) =>
          activeCompanyFilters.length === 0
            ? true
            : activeCompanyFilters.includes(normalizeSearchText(company)),
        )
        .map(([company, stopIds]) => {
          const stops = stopIds.map((stopId, seq) => {
            const stopName = getLocalizedValue(etaDb.stopList[stopId]?.name, language, stopId);
            const searchableStopName = normalizeStopSearchText(stopName);
            const stopSearchEnabled = searchMode === "all" || searchMode === "station";
            const isMatch = stopSearchEnabled && queryText ? searchableStopName.includes(queryText) : false;

            return {
              seq,
              stopId,
              stopName,
              isMatch,
            };
          });

          return {
            company,
            hasMatch: stops.some((stop) => stop.isMatch),
            matchCount: stops.filter((stop) => stop.isMatch).length,
            bestStopScore: stops.reduce((best, stop) => Math.max(best, getMatchScore(stop.stopName, searchText)), 0),
            stops: [
              ...stops.filter((stop) => stop.isMatch),
              ...stops.filter((stop) => !stop.isMatch),
            ],
          };
        });
      const stopMatches = stopsByCompany.some((companyGroup) => companyGroup.hasMatch);

      if (queryText && !routeMatches && !stopMatches) {
        return null;
      }

      return {
        routeId,
        routeNumber: route.route,
        origin: getLocalizedValue(route.orig, language),
        destination: getLocalizedValue(route.dest, language),
        companies:
          activeCompanyFilters.length === 0
            ? route.co ?? []
            : (route.co ?? []).filter((company) =>
                activeCompanyFilters.includes(normalizeSearchText(company)),
              ),
        companyMatches,
        routeMatches,
        stopMatches,
        routeNumberScore,
        routeFullNameScore,
        bestStopScore: Math.max(...stopsByCompany.map((group) => group.bestStopScore), 0),
        stopsByCompany: [
          ...stopsByCompany.filter((companyGroup) => companyGroup.hasMatch),
          ...stopsByCompany.filter((companyGroup) => !companyGroup.hasMatch),
        ],
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const bestMatchDelta =
        Math.max(right.routeFullNameScore ?? 0, right.routeNumberScore ?? 0, right.bestStopScore ?? 0) -
        Math.max(left.routeFullNameScore ?? 0, left.routeNumberScore ?? 0, left.bestStopScore ?? 0);
      const companyMatchDelta = Number(Boolean(right.companyMatches)) - Number(Boolean(left.companyMatches));
      const matchDelta =
        Number(Boolean(right.routeMatches || right.stopMatches)) -
        Number(Boolean(left.routeMatches || left.stopMatches));
      const stopMatchDelta = Number(Boolean(right.stopMatches)) - Number(Boolean(left.stopMatches));
      const routeMatchDelta = Number(Boolean(right.routeMatches)) - Number(Boolean(left.routeMatches));
      const routeNumberDelta = (left.routeNumber ?? "").localeCompare(right.routeNumber ?? "");

      return (
        bestMatchDelta ||
        stopMatchDelta ||
        routeMatchDelta ||
        companyMatchDelta ||
        matchDelta ||
        routeNumberDelta ||
        left.routeId.localeCompare(right.routeId)
      );
    });
}

function readStoredWatchList() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(BUS_STORAGE_KEY);

    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue);
    return Array.isArray(parsedValue) ? parsedValue : [];
  } catch {
    return [];
  }
}

function readStoredWatchGroups() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(BUS_GROUP_STORAGE_KEY);

    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue);
    return Array.isArray(parsedValue) ? parsedValue : [];
  } catch {
    return [];
  }
}

function readStoredTheme() {
  if (typeof window === "undefined") {
    return "origin";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return THEME_OPTIONS.some((theme) => theme.value === storedTheme) ? storedTheme : "origin";
}

function normalizeGroups(groups, validKeys = null) {
  return groups
    .map((group) => {
      const uniqueItemKeys = [...new Set(Array.isArray(group.itemKeys) ? group.itemKeys : [])].filter(
        (itemKey) => !validKeys || validKeys.has(itemKey),
      );

      return {
        id: group.id,
        name: typeof group.name === "string" && group.name.trim() ? group.name.trim() : "Merged stop",
        itemKeys: uniqueItemKeys,
      };
    })
    .filter((group) => typeof group.id === "string" && group.id && group.itemKeys.length >= 2);
}

function removeKeysFromGroups(groups, keysToRemove) {
  const removalSet = new Set(keysToRemove);
  return groups.map((group) => ({
    ...group,
    itemKeys: group.itemKeys.filter((itemKey) => !removalSet.has(itemKey)),
  }));
}

function createEditorPayload(watchlist, groups) {
  return {
    watchlist,
    groups,
  };
}

function stringifyEditorPayload(watchlist, groups) {
  return JSON.stringify(createEditorPayload(watchlist, groups), null, 2);
}

function sanitizeWatchlistInput(items, t) {
  if (!Array.isArray(items)) {
    throw new Error(t("bus.invalidArray"));
  }

  return items.map((item, index) => {
    if (!item || typeof item !== "object" || typeof item.routeId !== "string" || typeof item.seq !== "number") {
      throw new Error(t("bus.itemValidation", { index: index + 1 }));
    }

    return {
      label:
        typeof item.label === "string" && item.label.trim()
          ? item.label.trim()
          : t("bus.watchDefault", { index: index + 1 }),
      routeId: item.routeId.trim(),
      company: typeof item.company === "string" ? item.company.trim() : undefined,
      seq: item.seq,
    };
  });
}

function sanitizeGroupsInput(groups, watchlist) {
  if (groups == null) {
    return [];
  }

  if (!Array.isArray(groups)) {
    throw new Error("groups must be an array");
  }

  return normalizeGroups(groups, new Set(watchlist.map((watch) => getWatchKey(watch))));
}

async function loadWatchedBuses(watchedBuses, language, t) {
  const etaDb = await getEtaDb();

  const entries = await Promise.all(
    watchedBuses.map(async (watch) => {
      const route = etaDb.routeList[watch.routeId];

      if (!route) {
        return {
          ...watch,
          arrivals: [],
          error: t("bus.routeIdNotFound"),
        };
      }

      const company = watch.company && route.stops[watch.company] ? watch.company : route.co[0];
      const stopId = route.stops[company]?.[watch.seq];
      const stopName = stopId
        ? getLocalizedValue(etaDb.stopList[stopId]?.name, language, stopId)
        : t("bus.unknownStop");

      try {
        const etas = await fetchEtas({
          ...route,
          seq: watch.seq,
          language,
          stopList: etaDb.stopList,
          holidays: etaDb.holidays,
          serviceDayMap: etaDb.serviceDayMap,
        });

        return {
          ...watch,
          company,
          routeNumber: route.route,
          stopId,
          stopName,
          origin: getLocalizedValue(route.orig, language),
          destination: getLocalizedValue(route.dest, language),
          arrivals: etas.slice(0, 3).map((eta) => ({
            eta: eta.eta,
            remark: getLocalizedValue(eta.remark, language, ""),
            destination: getLocalizedValue(eta.dest, language),
            clock: formatClock(eta.eta, language),
            relative: formatMinutes(eta.eta, language, t),
          })),
        };
      } catch (error) {
        return {
          ...watch,
          company,
          routeNumber: route.route,
          stopId,
          stopName,
          origin: getLocalizedValue(route.orig, language),
          destination: getLocalizedValue(route.dest, language),
          arrivals: [],
          error: error instanceof Error ? error.message : t("bus.fetchEtaFailed"),
        };
      }
    }),
  );

  return {
    entries,
    updatedAt: new Date(),
  };
}

async function loadStopDetail(stopId, language) {
  const etaDb = await getEtaDb();
  const stopName = getLocalizedValue(etaDb.stopList[stopId]?.name, language, stopId);

  const services = Object.entries(etaDb.routeList)
    .flatMap(([routeId, route]) =>
      Object.entries(route.stops ?? {}).flatMap(([company, stopIds]) =>
        stopIds
          .map((currentStopId, seq) => ({ currentStopId, seq }))
          .filter(({ currentStopId }) => currentStopId === stopId)
          .map(({ seq }) => ({
            routeId,
            routeNumber: route.route,
            company,
            seq,
            origin: getLocalizedValue(route.orig, language),
            destination: getLocalizedValue(route.dest, language),
          })),
      ),
    )
    .sort((left, right) => {
      const routeDelta = (left.routeNumber ?? "").localeCompare(right.routeNumber ?? "");
      return routeDelta || left.company.localeCompare(right.company) || left.seq - right.seq;
    });

  return {
    stopId,
    stopName,
    services,
  };
}

async function loadRouteDetail(routeId, language) {
  const etaDb = await getEtaDb();
  const route = etaDb.routeList[routeId];

  if (!route) {
    throw new Error("Route not found");
  }

  const stopsByCompany = await Promise.all(
    Object.entries(route.stops ?? {}).map(async ([company, stopIds]) => {
      const stops = await Promise.all(
        stopIds.map(async (stopId, seq) => {
          const stopName = getLocalizedValue(etaDb.stopList[stopId]?.name, language, stopId);

          try {
            const etas = await fetchEtas({
              ...route,
              seq,
              language,
              stopList: etaDb.stopList,
              holidays: etaDb.holidays,
              serviceDayMap: etaDb.serviceDayMap,
            });
            const nextEta = etas[0];

            return {
              seq,
              stopId,
              stopName,
              isMatch: false,
              nextRelative: nextEta?.eta ? formatMinutes(nextEta.eta, language, translate.bind(null, language)) : "--",
              nextClock: nextEta?.eta ? formatClock(nextEta.eta, language) : "--",
            };
          } catch {
            return {
              seq,
              stopId,
              stopName,
              isMatch: false,
              nextRelative: "--",
              nextClock: "--",
            };
          }
        }),
      );

      return {
        company,
        stops,
      };
    }),
  );

  return {
    routeId,
    routeNumber: route.route,
    origin: getLocalizedValue(route.orig, language),
    destination: getLocalizedValue(route.dest, language),
    companies: route.co ?? [],
    stopsByCompany,
  };
}

function SearchResultCard({ result, onAdd, onOpenRoute, t }) {
  const showMatchedStopsOnly = result.stopMatches;
  const companyGroupsToShow = showMatchedStopsOnly
    ? result.stopsByCompany.filter((companyGroup) => companyGroup.hasMatch)
    : result.stopsByCompany;
  const companyThemeClass = getCompanyThemeClass(getPrimaryCompany(result.companies));

  return (
    <Card
      className="route-search-card route-search-card-link idk-ui-animate-slide-up"
      elevated
      role="button"
      tabIndex={0}
      onClick={() => onOpenRoute(result)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenRoute(result);
        }
      }}
    >
      <CardHeader
        title={
          <div className="route-card-headline">
            <button
              type="button"
              className={`route-number route-link-button ${companyThemeClass}`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenRoute(result);
              }}
            >
              {result.routeNumber}
            </button>
          </div>
        }
        description={[result.origin, result.destination].join(" - ")}
        action={
          result.stopMatches ? (
            <Badge variant="success">Stop match</Badge>
          ) : (
            <Badge variant="info" className={`company-pill ${companyThemeClass}`}>
              {result.companies.map(formatCompanyLabel).join(", ")}
            </Badge>
          )
        }
      />
      <CardContent className="route-card-content">
        {companyGroupsToShow.map((companyGroup) => {
          const stopsToShow = showMatchedStopsOnly
            ? companyGroup.stops.filter((stop) => stop.isMatch)
            : companyGroup.stops;

          return (
            <details
              key={`${result.routeId}-${companyGroup.company}`}
              className="stop-group"
              open={companyGroup.hasMatch}
              onClick={(event) => event.stopPropagation()}
            >
              <summary>
                <span>{t("bus.companyStops", { company: formatCompanyLabel(companyGroup.company) })}</span>
                <div className="stop-summary-badges">
                  {companyGroup.hasMatch ? (
                    <Badge variant="success">{companyGroup.matchCount} match</Badge>
                  ) : null}
                  <Badge variant="neutral">{stopsToShow.length}</Badge>
                </div>
              </summary>
              <div className="stop-list">
                {stopsToShow.map((stop) => (
                <div
                  key={`${result.routeId}-${companyGroup.company}-${stop.seq}`}
                  className={`stop-row${stop.isMatch ? " is-match" : ""}`}
                >
                  <div>
                    <p>{t("bus.stopSeq", { seq: stop.seq, stopName: stop.stopName })}</p>
                    <span>{t("bus.fromTo", { origin: result.origin, destination: result.destination })}</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<FaPlus aria-hidden="true" />}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAdd(
                        result.routeId,
                        companyGroup.company,
                        stop.seq,
                        `${result.routeNumber} seq ${stop.seq}`,
                      );
                    }}
                  >
                    {t("bus.add")}
                  </Button>
                </div>
                ))}
              </div>
            </details>
          );
        })}
      </CardContent>
    </Card>
  );
}

function RouteDetailPage({ route, onBack, onAdd, t }) {
  const companyThemeClass = getCompanyThemeClass(getPrimaryCompany(route.companies));

  return (
    <main className="route-detail-shell">
      <section className="route-detail-page">
        <div className="route-detail-topbar">
          <Button
            variant="secondary"
            leftIcon={<FaArrowLeft aria-hidden="true" />}
            onClick={onBack}
          >
            Back
          </Button>
        </div>

        <Card className="route-detail-hero" elevated>
          <CardContent>
            <div className="route-detail-heading">
              <div className="route-detail-copy">
                <span className={`route-number ${companyThemeClass}`}>{route.routeNumber}</span>
                <h1>{[route.origin, route.destination].join(" - ")}</h1>
                <p>
                  Route ID: {route.routeId}
                </p>
              </div>
              <div className="route-detail-badges">
                {route.companies.map((company) => (
                  <Badge key={company} variant="info" className={`company-pill ${getCompanyThemeClass(company)}`}>
                    {formatCompanyLabel(company)}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="route-detail-groups">
          {route.stopsByCompany.map((companyGroup) => (
            <Card
              key={`${route.routeId}-${companyGroup.company}`}
              className="route-detail-group"
              elevated
            >
              <CardHeader
                title={t("bus.companyStops", { company: formatCompanyLabel(companyGroup.company) })}
                action={<Badge variant="neutral">{companyGroup.stops.length}</Badge>}
              />
              <CardContent className="route-card-content">
                <div className="stop-list">
                  {companyGroup.stops.map((stop) => (
                    <div
                      key={`${route.routeId}-${companyGroup.company}-${stop.seq}`}
                      className={`stop-row${stop.isMatch ? " is-match" : ""}`}
                    >
                      <div>
                        <p>{t("bus.stopSeq", { seq: stop.seq, stopName: stop.stopName })}</p>
                        <span>{t("bus.fromTo", { origin: route.origin, destination: route.destination })}</span>
                        <span className="route-stop-time">
                          {stop.nextRelative} · {stop.nextClock}
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={<FaPlus aria-hidden="true" />}
                        onClick={() =>
                          onAdd(
                            route.routeId,
                            companyGroup.company,
                            stop.seq,
                            `${route.routeNumber} seq ${stop.seq}`,
                          )
                        }
                      >
                        {t("bus.add")}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}

function ArrivalCard({
  entry,
  onRemove,
  onMerge,
  onManageGroup,
  onOpenStop,
  onOpenRoute,
  onSelectGroupEntry,
  groupEntries = [],
  t,
}) {
  const isGrouped = groupEntries.length > 1;
  const companyThemeClass = getCompanyThemeClass(entry.company);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handlePrimarySettingAction = (event) => {
    event.stopPropagation();

    if (isGrouped && onManageGroup) {
      onManageGroup(entry);
      setIsSettingsOpen(false);
      return;
    }

    onMerge(entry);
    setIsSettingsOpen(false);
  };

  const handleRemoveSettingAction = (event) => {
    event.stopPropagation();
    onRemove(entry.routeId, entry.company, entry.seq);
    setIsSettingsOpen(false);
  };

  return (
    <Card className={`arrival-card ${companyThemeClass} idk-ui-animate-slide-up`} elevated>
      <CardContent className="arrival-card-content">
        <div className="arrival-card-top">
          <div className="arrival-card-copy">
            <div className="arrival-card-tags">
              {!isGrouped ? (
                <button
                  type="button"
                  className={`route-number route-link-button arrival-route-button ${companyThemeClass}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenRoute(entry);
                  }}
                >
                  {entry.routeNumber}
                </button>
              ) : null}
              {isGrouped ? (
                <div className="group-bus-list">
                  {/** group heatmap keeps the tap targets, but shades each chip by next bus time */}
                  {groupEntries.map((groupEntry) => (
                    <button
                      type="button"
                      key={getWatchKey(groupEntry)}
                      className={`group-bus-chip${
                        getWatchKey(groupEntry) === getWatchKey(entry) ? " is-active" : ""
                      }`}
                      style={groupEntry.chipStyle}
                      aria-pressed={getWatchKey(groupEntry) === getWatchKey(entry)}
                      aria-label={`${groupEntry.routeNumber}, ${groupEntry.nextRelativeLabel ?? "--"}`}
                      title={groupEntry.nextRelativeLabel ?? "--"}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectGroupEntry?.(getWatchKey(groupEntry));
                      }}
                    >
                      {groupEntry.routeNumber}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <p className="arrival-path">往 {entry.destination}</p>
          </div>
          <div className="arrival-primary">
            <span>{t("bus.nextBus")}</span>
            <strong>{entry.arrivals[0]?.relative ?? "--"}</strong>
            <div className="arrival-card-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsSettingsOpen((current) => !current);
                }}
              >
                Setting
              </Button>
              {isSettingsOpen ? (
                <div className="arrival-card-menu">
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<FaCode aria-hidden="true" />}
                    onClick={handlePrimarySettingAction}
                  >
                    {isGrouped ? "Manage Group" : "Merge"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<FaTrash aria-hidden="true" />}
                    onClick={handleRemoveSettingAction}
                  >
                    {t("bus.remove")}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="stop-line stop-line-button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenStop(entry.stopId, entry.stopName);
          }}
        >
          <FaLocationDot aria-hidden="true" />
          <span>{entry.stopName}</span>
        </button>

        {entry.error ? (
          <p className="error-text">{entry.error}</p>
        ) : (
          <div className="eta-grid">
            {entry.arrivals.map((arrival, index) => (
              <div key={`${entry.routeId}-${arrival.eta}-${index}`} className="eta-tile">
                <span className="eta-label">
                  {index === 0 ? t("bus.next") : t("bus.etaNumber", { index: index + 1 })}
                </span>
                <strong>{arrival.relative}</strong>
                <div className="eta-clock">
                  <FaClock aria-hidden="true" />
                  <span>{arrival.clock}</span>
                </div>
                {arrival.remark ? <p>{arrival.remark}</p> : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MergedArrivalCard({ group, entries, onRemove, onMerge, onManageGroup, onOpenStop, onOpenRoute, onUngroup, t }) {
  const [activeItemKey, setActiveItemKey] = useState(() => getWatchKey(entries[0] ?? {}));
  const activeEntry =
    entries.find((entry) => getWatchKey(entry) === activeItemKey) ?? entries[0] ?? null;
  const groupEntries = useMemo(() => {
    const arrivalMinutes = entries
      .map((entry) => ({
        key: getWatchKey(entry),
        nextRelativeLabel: entry.arrivals[0]?.relative ?? null,
        minutes: getNextArrivalMinutes(entry.arrivals[0]?.eta),
      }))
      .filter(Boolean);
    const validMinutes = arrivalMinutes.map((item) => item.minutes).filter((value) => value != null);
    const minMinutes = validMinutes.length > 0 ? Math.min(...validMinutes) : 0;
    const maxMinutes = validMinutes.length > 0 ? Math.max(...validMinutes) : 0;

    return entries.map((entry) => {
      const item = arrivalMinutes.find((candidate) => candidate.key === getWatchKey(entry));
      const isActive = getWatchKey(entry) === activeItemKey;

      return {
        ...entry,
        nextRelativeLabel: item?.nextRelativeLabel,
        chipStyle: {
          ...buildGroupChipStyle(item?.minutes ?? null, minMinutes, maxMinutes, entry.company),
          "--group-chip-scale": getGroupChipScale(isActive),
        },
      };
    });
  }, [entries, activeItemKey]);

  const handleNext = () => {
    if (entries.length <= 1) {
      return;
    }

    const currentIndex = Math.max(
      entries.findIndex((entry) => getWatchKey(entry) === getWatchKey(activeEntry ?? {})),
      0,
    );
    const nextEntry = entries[(currentIndex + 1) % entries.length];

    if (nextEntry) {
      setActiveItemKey(getWatchKey(nextEntry));
    }
  };

  useEffect(() => {
    if (entries.length === 0) {
      return;
    }

    const activeExists = entries.some((entry) => getWatchKey(entry) === activeItemKey);
    if (!activeExists) {
      setActiveItemKey(getWatchKey(entries[0]));
    }
  }, [activeItemKey, entries]);

  if (!activeEntry) {
    return null;
  }

  return (
    <div
      className="merged-arrival-card"
      role="button"
      tabIndex={0}
      onClick={handleNext}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleNext();
        }
      }}
    >
      <ArrivalCard
        entry={activeEntry}
        onRemove={onRemove}
        onMerge={onMerge}
        onManageGroup={() => onManageGroup(group, activeEntry)}
        onOpenStop={onOpenStop}
        onOpenRoute={onOpenRoute}
        onSelectGroupEntry={setActiveItemKey}
        groupEntries={groupEntries}
        t={t}
      />
    </div>
  );
}

function StopDetailPage({ stop, onBack, onOpenRoute, t }) {
  return (
    <main className="route-detail-shell">
      <section className="route-detail-page">
        <div className="route-detail-topbar">
          <Button
            variant="secondary"
            leftIcon={<FaArrowLeft aria-hidden="true" />}
            onClick={onBack}
          >
            Back
          </Button>
        </div>

        <Card className="route-detail-hero" elevated>
          <CardContent>
            <div className="route-detail-copy">
              <h1>{stop.stopName}</h1>
              <p>Stop ID: {stop.stopId}</p>
              <Badge variant="info">{stop.services.length} buses</Badge>
            </div>
          </CardContent>
        </Card>

        <div className="route-detail-groups">
          {stop.services.map((service) => (
            <Card
              key={`${service.routeId}-${service.company}-${service.seq}`}
              className="route-detail-group route-search-card-link"
              elevated
              role="button"
              tabIndex={0}
              onClick={() => onOpenRoute(service)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenRoute(service);
                }
              }}
            >
              <CardContent className="stop-service-card">
                <div className="route-card-headline">
                  <span className={`route-number ${getCompanyThemeClass(service.company)}`}>{service.routeNumber}</span>
                  <Badge variant="info" className={`company-pill ${getCompanyThemeClass(service.company)}`}>
                    {formatCompanyLabel(service.company)}
                  </Badge>
                </div>
                <h3>{service.destination}</h3>
                <p className="arrival-path">{t("bus.fromTo", { origin: service.origin, destination: service.destination })}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}

function BusEtaPage() {
  const language = DEFAULT_LANGUAGE;
  const t = (key, values) => translate(language, key, values);
  const { show } = useToast();
  const initialWatchlist = useMemo(() => readStoredWatchList(), []);
  const initialGroups = useMemo(() => readStoredWatchGroups(), []);
  const initialTheme = useMemo(() => readStoredTheme(), []);
  const [watchedBuses, setWatchedBuses] = useState(initialWatchlist);
  const [draftValue, setDraftValue] = useState(() =>
    stringifyEditorPayload(initialWatchlist, initialGroups),
  );
  const [entries, setEntries] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchFeedback, setSearchFeedback] = useState(t("bus.searchPrompt"));
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const [searchMode, setSearchMode] = useState("all");
  const [selectedCompanies, setSelectedCompanies] = useState([]);
  const [searchVisibleCount, setSearchVisibleCount] = useState(SEARCH_INITIAL_LIMIT);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState(initialTheme);
  const [watchGroups, setWatchGroups] = useState(initialGroups);
  const [draggingCardToken, setDraggingCardToken] = useState("");
  const [mergeSourceKey, setMergeSourceKey] = useState("");
  const [managedGroupId, setManagedGroupId] = useState("");
  const [selectedRouteDetail, setSelectedRouteDetail] = useState(null);
  const [selectedStopDetail, setSelectedStopDetail] = useState(null);
  const [mergeGroupName, setMergeGroupName] = useState("");
  const [mergeSelection, setMergeSelection] = useState([]);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    if (!isEditorOpen && !isSearchOpen && !isThemeOpen && !mergeSourceKey) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsEditorOpen(false);
        setIsSearchOpen(false);
        setIsThemeOpen(false);
        setMergeSourceKey("");
        setManagedGroupId("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isEditorOpen, isSearchOpen, isThemeOpen, mergeSourceKey]);

  useEffect(() => {
    document.body.dataset.theme = selectedTheme;
    window.localStorage.setItem(THEME_STORAGE_KEY, selectedTheme);

    return () => {
      delete document.body.dataset.theme;
    };
  }, [selectedTheme]);

  useEffect(() => {
    const validKeys = new Set(watchedBuses.map((watch) => getWatchKey(watch)));
    const nextGroups = normalizeGroups(watchGroups, validKeys);

    if (JSON.stringify(nextGroups) !== JSON.stringify(watchGroups)) {
      setWatchGroups(nextGroups);
      return;
    }

    window.localStorage.setItem(BUS_GROUP_STORAGE_KEY, JSON.stringify(nextGroups));
  }, [watchGroups, watchedBuses]);

  useEffect(() => {
    setDraftValue(stringifyEditorPayload(watchedBuses, watchGroups));
  }, [watchedBuses, watchGroups]);

  const systemChecks = useMemo(
    () => [
      {
        name: t("bus.library"),
        ok: true,
        detail: "hk-bus-eta",
      },
      {
        name: t("bus.refreshEvery"),
        ok: true,
        detail: t("bus.every30s"),
      },
      {
        name: t("bus.lastSync"),
        ok: Boolean(updatedAt),
        detail: updatedAt
          ? updatedAt.toLocaleTimeString(language === "zh" ? "zh-HK" : "en-HK", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
          : "--",
      },
    ],
    [language, updatedAt],
  );

  useEffect(() => {
    let cancelled = false;

    const refresh = async ({ silent = false } = {}) => {
      if (!silent) {
        setIsLoading(true);
      }

      setError("");

      if (watchedBuses.length === 0) {
        setEntries([]);
        setUpdatedAt(null);
        setIsLoading(false);
        return;
      }

      try {
        const result = await loadWatchedBuses(watchedBuses, language, t);

        if (cancelled) {
          return;
        }

        setEntries(result.entries);
        setUpdatedAt(result.updatedAt);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : t("bus.unableLoadEta"));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    refresh();
    const intervalId = window.setInterval(() => {
      refresh({ silent: true });
    }, BUS_REFRESH_INTERVAL);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [watchedBuses]);

  useEffect(() => {
    const trimmedQuery = deferredSearchQuery.trim();
    const hasCompanyFilter = selectedCompanies.length > 0;

    setSearchVisibleCount(SEARCH_INITIAL_LIMIT);

    if (!trimmedQuery && !hasCompanyFilter) {
      setSearchResults([]);
      setIsSearching(false);
      setSearchFeedback(t("bus.searchPrompt"));
      return undefined;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        setIsSearching(true);
        setSearchFeedback(t("bus.searchLoading"));
        const etaDb = await getEtaDb();

        if (cancelled) {
          return;
        }

        const matches = searchEtaRoutes(etaDb, trimmedQuery, language, searchMode, selectedCompanies);

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setSearchResults(matches);
          const searchModeLabel =
            SEARCH_MODE_OPTIONS.find((option) => option.value === searchMode)?.label ?? "全部";
          const selectedCompanyLabels = COMPANY_FILTER_OPTIONS
            .filter((option) => selectedCompanies.includes(option.value))
            .map((option) => option.label);
          const feedbackSuffix = [searchModeLabel, ...selectedCompanyLabels].join(" · ");
          setSearchFeedback(
            matches.length > 0
              ? `${t("bus.searchFound", { count: matches.length })} · ${feedbackSuffix}`
              : `${t("bus.searchNotFound")} · ${feedbackSuffix}`,
          );
        });
      } catch (searchError) {
        if (cancelled) {
          return;
        }

        setSearchResults([]);
        setSearchFeedback(
          searchError instanceof Error ? searchError.message : t("bus.searchFailed"),
        );
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [deferredSearchQuery, language, searchMode, selectedCompanies]);

  const persistWatchList = (nextValue, toastMessage) => {
    window.localStorage.setItem(BUS_STORAGE_KEY, JSON.stringify(nextValue));
    setWatchedBuses(nextValue);

    if (toastMessage) {
      show({
        tone: "success",
        title: t("bus.saved"),
        description: toastMessage,
      });
    }
  };

  const handleToggleSearchCompany = (company) => {
    setSelectedCompanies((current) =>
      current.includes(company)
        ? current.filter((value) => value !== company)
        : [...current, company],
    );
  };

  const handleSelectTheme = (theme) => {
    setSelectedTheme(theme);
  };

  const visibleSearchResults = searchResults.slice(0, searchVisibleCount);
  const canLoadMoreSearchResults = searchVisibleCount < searchResults.length;
  const handleLoadMoreSearchResults = () => {
    setSearchVisibleCount((current) => current + SEARCH_LOAD_MORE_STEP);
  };

  const handleSaveWatchList = () => {
    setError("");

    try {
      const parsedValue = JSON.parse(draftValue);
      const sanitizedWatchlist = sanitizeWatchlistInput(
        Array.isArray(parsedValue) ? parsedValue : parsedValue?.watchlist,
        t,
      );
      const sanitizedGroups = sanitizeGroupsInput(
        Array.isArray(parsedValue) ? [] : parsedValue?.groups,
        sanitizedWatchlist,
      );

      setWatchGroups(sanitizedGroups);
      persistWatchList(sanitizedWatchlist, t("bus.saveSuccess"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("bus.invalidJson"));
    }
  };

  const handleAddWatch = (routeId, company, seq, label) => {
    const alreadySaved = watchedBuses.some(
      (watch) => watch.routeId === routeId && watch.seq === seq && watch.company === company,
    );

    if (alreadySaved) {
      show({
        tone: "info",
        title: t("bus.duplicate"),
        description: t("bus.addDuplicate"),
      });
      return;
    }

    const nextValue = [...watchedBuses, { label, routeId, company, seq }];
    persistWatchList(nextValue, t("bus.addSuccess"));
  };

  const handleRemoveWatch = (routeId, company, seq) => {
    const removedKey = getWatchKey({ routeId, company, seq });
    const nextValue = watchedBuses.filter(
      (watch) => !(watch.routeId === routeId && watch.seq === seq && watch.company === company),
    );
    setWatchGroups((current) =>
      normalizeGroups(
        current.map((group) => ({
          ...group,
          itemKeys: group.itemKeys.filter((itemKey) => itemKey !== removedKey),
        })),
        new Set(nextValue.map((watch) => getWatchKey(watch))),
      ),
    );
    persistWatchList(nextValue, t("bus.removeSuccess"));
  };

  const handleReorderCard = (sourceToken, targetToken) => {
    if (!sourceToken || !targetToken || sourceToken === targetToken) {
      return;
    }

    const watchByKey = new Map(watchedBuses.map((watch) => [getWatchKey(watch), watch]));
    const sourceKeys = sourceToken.startsWith("group:")
      ? normalizedGroups.find((group) => group.id === sourceToken.slice(6))?.itemKeys ?? []
      : [sourceToken];
    const targetKeys = targetToken.startsWith("group:")
      ? normalizedGroups.find((group) => group.id === targetToken.slice(6))?.itemKeys ?? []
      : [targetToken];

    if (sourceKeys.length === 0 || targetKeys.length === 0) {
      return;
    }

    const movedItems = sourceKeys.map((itemKey) => watchByKey.get(itemKey)).filter(Boolean);
    const sourceKeySet = new Set(sourceKeys);
    const nextValue = watchedBuses.filter((watch) => !sourceKeySet.has(getWatchKey(watch)));
    const targetIndex = nextValue.findIndex((watch) => getWatchKey(watch) === targetKeys[0]);

    if (targetIndex < 0 || movedItems.length === 0) {
      return;
    }

    nextValue.splice(targetIndex, 0, ...movedItems);
    persistWatchList(nextValue);
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    setError("");

    if (watchedBuses.length === 0) {
      setEntries([]);
      setUpdatedAt(null);
      setIsLoading(false);
      return;
    }

    try {
      const result = await loadWatchedBuses(watchedBuses, language, t);
      setEntries(result.entries);
      setUpdatedAt(result.updatedAt);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("bus.unableLoadEta"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenMerge = (entry) => {
    const sourceKey = getWatchKey(entry);
    setMergeSourceKey(sourceKey);
    setManagedGroupId("");
    setMergeGroupName(entry.stopName || `${entry.routeNumber} group`);
    setMergeSelection([]);
  };

  const handleOpenManageGroup = (group, entry) => {
    setMergeSourceKey(getWatchKey(entry));
    setManagedGroupId(group.id);
    setMergeGroupName(group.name);
    setMergeSelection([]);
  };

  const handleToggleMergeSelection = (itemKey) => {
    setMergeSelection((current) =>
      current.includes(itemKey) ? current.filter((value) => value !== itemKey) : [...current, itemKey],
    );
  };

  const handleCreateMergeGroup = () => {
    if (!mergeSourceKey || mergeSelection.length === 0) {
      return;
    }

    const movingKeys = [mergeSourceKey, ...mergeSelection];
    const nextGroup = {
      id: `group-${Date.now()}`,
      name: mergeGroupName.trim() || "Merged stop",
      itemKeys: movingKeys,
    };

    setWatchGroups((current) => normalizeGroups([...removeKeysFromGroups(current, movingKeys), nextGroup]));
    setMergeSourceKey("");
    setManagedGroupId("");
    setMergeSelection([]);
    setMergeGroupName("");
  };

  const handleAddToExistingGroup = (groupId) => {
    if (!mergeSourceKey) {
      return;
    }

    setWatchGroups((current) =>
      normalizeGroups(
        removeKeysFromGroups(current, [mergeSourceKey]).map((group) =>
          group.id === groupId ? { ...group, itemKeys: [...group.itemKeys, mergeSourceKey] } : group,
        ),
      ),
    );
    setMergeSourceKey("");
    setManagedGroupId("");
    setMergeSelection([]);
    setMergeGroupName("");
  };

  const handleAddMemberToGroup = (groupId, itemKey) => {
    setWatchGroups((current) =>
      normalizeGroups(
        removeKeysFromGroups(current, [itemKey]).map((group) =>
          group.id === groupId ? { ...group, itemKeys: [...group.itemKeys, itemKey] } : group,
        ),
      ),
    );
  };

  const handleRemoveMemberFromGroup = (groupId, itemKey) => {
    const currentGroup = watchGroups.find((group) => group.id === groupId);

    setWatchGroups((current) =>
      normalizeGroups(
        current.map((group) =>
          group.id === groupId
            ? { ...group, itemKeys: group.itemKeys.filter((groupItemKey) => groupItemKey !== itemKey) }
            : group,
        ),
      ),
    );

    if (currentGroup && currentGroup.itemKeys.length <= 2) {
      setMergeSourceKey("");
      setManagedGroupId("");
    }
  };

  const handleUngroup = (groupId) => {
    setWatchGroups((current) => current.filter((group) => group.id !== groupId));
  };

  const handleOpenRouteDetail = async (route) => {
    setIsSearchOpen(false);
    setSelectedRouteDetail({
      routeId: route.routeId,
      routeNumber: route.routeNumber,
      origin: route.origin,
      destination: route.destination,
      companies: route.companies ?? (route.company ? [route.company] : []),
      stopsByCompany: [],
      isLoading: true,
    });
    setSelectedStopDetail(null);

    const detail = await loadRouteDetail(route.routeId, language);
    setSelectedRouteDetail({
      ...detail,
      isLoading: false,
    });
  };

  const handleOpenStopDetail = async (stopId, stopName) => {
    setSelectedStopDetail({
      stopId,
      stopName,
      services: [],
      isLoading: true,
    });

    const detail = await loadStopDetail(stopId, language);
    setSelectedStopDetail({
      ...detail,
      isLoading: false,
    });
  };

  const entryMap = useMemo(
    () => Object.fromEntries(entries.map((entry) => [getWatchKey(entry), entry])),
    [entries],
  );
  const normalizedGroups = useMemo(
    () => normalizeGroups(watchGroups, new Set(entries.map((entry) => getWatchKey(entry)))),
    [entries, watchGroups],
  );
  const groupedKeys = useMemo(
    () => new Set(normalizedGroups.flatMap((group) => group.itemKeys)),
    [normalizedGroups],
  );
  const groupedEntrySets = useMemo(
    () =>
      normalizedGroups
        .map((group) => ({
          ...group,
          entries: group.itemKeys.map((itemKey) => entryMap[itemKey]).filter(Boolean),
        }))
        .filter((group) => group.entries.length >= 2),
    [entryMap, normalizedGroups],
  );
  const displayCards = useMemo(() => {
    const groupByItemKey = new Map(
      groupedEntrySets.flatMap((group) => group.itemKeys.map((itemKey) => [itemKey, group])),
    );
    const seenGroupIds = new Set();

    return watchedBuses.flatMap((watch) => {
      const itemKey = getWatchKey(watch);
      const groupedCard = groupByItemKey.get(itemKey);

      if (groupedCard) {
        if (seenGroupIds.has(groupedCard.id)) {
          return [];
        }

        seenGroupIds.add(groupedCard.id);
        return [
          {
            type: "group",
            token: `group:${groupedCard.id}`,
            group: groupedCard,
          },
        ];
      }

      const entry = entryMap[itemKey];
      return entry
        ? [
            {
              type: "entry",
              token: itemKey,
              entry,
            },
          ]
        : [];
    });
  }, [entryMap, groupedEntrySets, watchedBuses]);
  const mergeSourceEntry = mergeSourceKey ? entryMap[mergeSourceKey] : null;
  const activeManagedGroup = managedGroupId
    ? normalizedGroups.find((group) => group.id === managedGroupId) ?? null
    : null;
  const mergeCandidateEntries = entries.filter((entry) => {
    const itemKey = getWatchKey(entry);
    if (activeManagedGroup) {
      return !activeManagedGroup.itemKeys.includes(itemKey) && !groupedKeys.has(itemKey);
    }

    return itemKey !== mergeSourceKey && !groupedKeys.has(itemKey);
  });

  if (selectedRouteDetail) {
    if (selectedRouteDetail.isLoading) {
      return (
        <main className="route-detail-shell">
          <section className="route-detail-page">
            <div className="route-detail-topbar">
              <Button
                variant="secondary"
                leftIcon={<FaArrowLeft aria-hidden="true" />}
                onClick={() => setSelectedRouteDetail(null)}
              >
                Back
              </Button>
            </div>
            <p className="search-feedback">Loading route info...</p>
          </section>
        </main>
      );
    }

    return (
      <RouteDetailPage
        route={selectedRouteDetail}
        onBack={() => setSelectedRouteDetail(null)}
        onAdd={handleAddWatch}
        t={t}
      />
    );
  }

  if (selectedStopDetail) {
    if (selectedStopDetail.isLoading) {
      return (
        <main className="route-detail-shell">
          <section className="route-detail-page">
            <div className="route-detail-topbar">
              <Button
                variant="secondary"
                leftIcon={<FaArrowLeft aria-hidden="true" />}
                onClick={() => setSelectedStopDetail(null)}
              >
                Back
              </Button>
            </div>
            <p className="search-feedback">Loading stop info...</p>
          </section>
        </main>
      );
    }

    return (
      <StopDetailPage
        stop={selectedStopDetail}
        onBack={() => setSelectedStopDetail(null)}
        onOpenRoute={handleOpenRouteDetail}
        t={t}
      />
    );
  }

  return (
    <main className="app-shell">
      <section className="content-grid">
        <div className="primary-column">
          <SectionCard
            className="section-panel"
            elevated
            title={
              <SectionTitleWithIcon icon={<FaBusSimple aria-hidden="true" />}>
                {t("bus.liveTitle")}
              </SectionTitleWithIcon>
            }
            description={t("bus.liveDescription")}
            action={<Badge variant="success">{entries.length}</Badge>}
          >
            <div className="panel-content">
              {error ? <p className="error-text">{error}</p> : null}

              {!error && !isLoading && watchedBuses.length === 0 ? (
                <EmptyState
                  title={t("bus.noSavedBuses")}
                  description={t("bus.routeSearchHelp")}
                  action={
                    <Button
                      leftIcon={<FaPlus aria-hidden="true" />}
                      onClick={() => setIsSearchOpen(true)}
                    >
                      {t("bus.addStop")}
                    </Button>
                  }
                />
              ) : null}

              <div className="arrival-list">
                {displayCards.map((card) => (
                  <div
                    key={card.token}
                    className={`arrival-card-shell${
                      draggingCardToken === card.token ? " is-dragging" : ""
                    }`}
                    draggable
                    onDragStart={() => setDraggingCardToken(card.token)}
                    onDragEnd={() => setDraggingCardToken("")}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      handleReorderCard(draggingCardToken, card.token);
                      setDraggingCardToken("");
                    }}
                  >
                    {card.type === "group" ? (
                      <MergedArrivalCard
                        group={card.group}
                        entries={card.group.entries}
                        onRemove={handleRemoveWatch}
                        onMerge={handleOpenMerge}
                        onManageGroup={handleOpenManageGroup}
                        onOpenStop={handleOpenStopDetail}
                        onOpenRoute={handleOpenRouteDetail}
                        onUngroup={handleUngroup}
                        t={t}
                      />
                    ) : (
                      <ArrivalCard
                        entry={card.entry}
                        onRemove={handleRemoveWatch}
                        onMerge={handleOpenMerge}
                        onManageGroup={null}
                        onOpenStop={handleOpenStopDetail}
                        onOpenRoute={handleOpenRouteDetail}
                        t={t}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        </div>

        <aside className="secondary-column">
          <SystemStatusPanel
            className="section-panel system-status-panel"
            title={
              <SectionTitleWithIcon icon={<FaDatabase aria-hidden="true" />}>
                {t("bus.dataSource")}
              </SectionTitleWithIcon>
            }
            online={!isLoading}
            statusLabel={isLoading ? t("bus.syncing") : t("bus.liveFeed")}
            checks={systemChecks}
          />
        </aside>
      </section>

      <div className="floating-button-stack">
        <button
          type="button"
          className="floating-editor-button floating-search-button"
          aria-label={t("bus.routeSearch")}
          title={t("bus.routeSearch")}
          onClick={() => setIsSearchOpen(true)}
        >
          <FaMagnifyingGlass aria-hidden="true" />
        </button>

        <button
          type="button"
          className="floating-editor-button floating-theme-button"
          aria-label="Choose theme"
          title="Choose theme"
          onClick={() => setIsThemeOpen(true)}
        >
          <FaPalette aria-hidden="true" />
        </button>

        <button
          type="button"
          className="floating-editor-button"
          aria-label={t("bus.editJson")}
          title={t("bus.editJson")}
          onClick={() => setIsEditorOpen(true)}
        >
          <FaCode aria-hidden="true" />
        </button>
      </div>

      {isSearchOpen ? (
        <div
          className="editor-modal-backdrop"
          role="presentation"
        >
          <section
            className="editor-modal search-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="route-search-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="editor-modal-header">
              <div>
                <p className="editor-modal-eyebrow">{t("bus.routeSearch")}</p>
                <h2 id="route-search-title">{t("bus.routeSearch")}</h2>
                <p className="editor-modal-description">{t("bus.routeSearchHelp")}</p>
              </div>
              <button
                type="button"
                className="editor-modal-close"
                aria-label={t("bus.closeSearch")}
                onClick={() => setIsSearchOpen(false)}
              >
                <FaXmark aria-hidden="true" />
              </button>
            </div>

            <SectionCard
              className="section-panel search-panel"
              elevated
              title={t("bus.routeSearch")}
              action={
                <Badge variant="info">{isSearching ? t("bus.searching") : t("bus.ready")}</Badge>
              }
            >
              <div className="panel-content">
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t("bus.searchPlaceholder")}
                  inputSize="lg"
                />
                <div className="search-filter-bar">
                  <div className="search-mode-row" role="tablist" aria-label="Search mode">
                    {SEARCH_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`search-mode-chip${searchMode === option.value ? " is-active" : ""}`}
                        onClick={() => setSearchMode(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="search-mode-row" role="tablist" aria-label="Company filter">
                  {COMPANY_FILTER_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`search-mode-chip ${getCompanyThemeClass(option.value)}${selectedCompanies.includes(option.value) ? " is-active" : ""}`}
                      onClick={() => handleToggleSearchCompany(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                  </div>
                </div>
                <p className="search-feedback">{searchFeedback}</p>
                <div className="search-results">
                  {visibleSearchResults.map((result) => (
                    <SearchResultCard
                      key={result.routeId}
                      result={result}
                      onAdd={handleAddWatch}
                      onOpenRoute={handleOpenRouteDetail}
                      t={t}
                    />
                  ))}
                </div>
                {canLoadMoreSearchResults ? (
                  <div className="search-load-more">
                    <Button variant="secondary" onClick={handleLoadMoreSearchResults}>
                      Load more
                    </Button>
                  </div>
                ) : null}
              </div>
            </SectionCard>
          </section>
        </div>
      ) : null}

      {isThemeOpen ? (
        <div className="editor-modal-backdrop" role="presentation">
          <section
            className="editor-modal theme-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="theme-selector-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="editor-modal-header">
              <div>
                <p className="editor-modal-eyebrow">Theme</p>
                <h2 id="theme-selector-title">Choose theme</h2>
                <p className="editor-modal-description">
                  Switch the whole app atmosphere and keep your choice for next time.
                </p>
              </div>
              <button
                type="button"
                className="editor-modal-close"
                aria-label="Close theme picker"
                onClick={() => setIsThemeOpen(false)}
              >
                <FaXmark aria-hidden="true" />
              </button>
            </div>

            <div className="theme-option-list">
              {THEME_OPTIONS.map((theme) => (
                <button
                  key={theme.value}
                  type="button"
                  className={`theme-option-card${
                    selectedTheme === theme.value ? " is-active" : ""
                  }`}
                  onClick={() => handleSelectTheme(theme.value)}
                >
                  <div className={`theme-option-preview theme-preview-${theme.value}`} aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="theme-option-copy">
                    <strong>{theme.label}</strong>
                    <p>{theme.description}</p>
                  </div>
                  <span className="theme-option-state">
                    {selectedTheme === theme.value ? "Selected" : "Apply"}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {isEditorOpen ? (
        <div
          className="editor-modal-backdrop"
          role="presentation"
        >
          <section
            className="editor-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="watchlist-editor-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="editor-modal-header">
              <div>
                <p className="editor-modal-eyebrow">{t("bus.watchStorage")}</p>
                <h2 id="watchlist-editor-title">{t("bus.editJson")}</h2>
                <p className="editor-modal-description">{t("bus.watchStorageHelp")}</p>
              </div>
              <button
                type="button"
                className="editor-modal-close"
                aria-label={t("bus.hideJson")}
                onClick={() => setIsEditorOpen(false)}
              >
                <FaXmark aria-hidden="true" />
              </button>
            </div>

            <div className="panel-content">
              <Textarea
                value={draftValue}
                onChange={(event) => setDraftValue(event.target.value)}
                resize="vertical"
                rows={14}
              />
              <div className="editor-footer">
                <p>{t("bus.storageNote")}</p>
                <Button onClick={handleSaveWatchList}>{t("bus.saveArray")}</Button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {mergeSourceEntry ? (
        <div
          className="editor-modal-backdrop"
          role="presentation"
        >
          <section
            className="editor-modal merge-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="merge-group-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="editor-modal-header">
              <div>
                <p className="editor-modal-eyebrow">Merge cards</p>
                <h2 id="merge-group-title">Create manual group</h2>
                <p className="editor-modal-description">
                  Group cards by place manually, then switch between them inside one merged card.
                </p>
              </div>
              <button
                type="button"
                className="editor-modal-close"
                aria-label="Close merge"
                onClick={() => {
                  setMergeSourceKey("");
                  setManagedGroupId("");
                }}
              >
                <FaXmark aria-hidden="true" />
              </button>
            </div>

            {activeManagedGroup ? (
              <>
                <div className="merge-source-pill">
                  Managing: {activeManagedGroup.itemKeys.length} buses
                </div>

                <div className="merge-section">
                  <p className="merge-section-title">Current buses</p>
                  <div className="merge-group-list">
                    {activeManagedGroup.itemKeys.map((itemKey) => {
                      const entry = entryMap[itemKey];

                      if (!entry) {
                        return null;
                      }

                      return (
                        <div key={itemKey} className="manage-group-row">
                    <span>
                      {entry.routeNumber} {entry.destination}
                    </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveMemberFromGroup(activeManagedGroup.id, itemKey)}
                          >
                            Remove
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="merge-section">
                  <p className="merge-section-title">Add more buses</p>
                  <div className="merge-candidate-list">
                    {mergeCandidateEntries.map((entry) => {
                      const itemKey = getWatchKey(entry);
                      return (
                        <div key={itemKey} className="manage-group-row">
                          <div>
                            <span>
                              {entry.routeNumber} {entry.destination}
                            </span>
                            <small>{entry.stopName}</small>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleAddMemberToGroup(activeManagedGroup.id, itemKey)}
                          >
                            Add
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="merge-source-pill">
                  Source: {mergeSourceEntry.routeNumber} {mergeSourceEntry.destination}
                </div>

                {watchGroups.length > 0 ? (
                  <div className="merge-section">
                    <p className="merge-section-title">Add to existing group</p>
                    <div className="merge-group-list">
                      {watchGroups.map((group) => (
                        <Button
                          key={group.id}
                          variant="secondary"
                          onClick={() => handleAddToExistingGroup(group.id)}
                        >
                          {group.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="merge-section">
                  <p className="merge-section-title">Create new group</p>
                  <Input
                    value={mergeGroupName}
                    onChange={(event) => setMergeGroupName(event.target.value)}
                    placeholder="Group name"
                    inputSize="lg"
                  />
                  <div className="merge-candidate-list">
                    {mergeCandidateEntries.map((entry) => {
                      const itemKey = getWatchKey(entry);
                      return (
                        <label key={itemKey} className="merge-candidate-row">
                          <input
                            type="checkbox"
                            checked={mergeSelection.includes(itemKey)}
                            onChange={() => handleToggleMergeSelection(itemKey)}
                          />
                          <span>
                            {entry.routeNumber} {entry.destination}
                          </span>
                          <small>{entry.stopName}</small>
                        </label>
                      );
                    })}
                  </div>
                  <div className="merge-footer">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setMergeSourceKey("");
                        setManagedGroupId("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button onClick={handleCreateMergeGroup}>Create group</Button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <BusEtaPage />
    </ToastProvider>
  );
}
