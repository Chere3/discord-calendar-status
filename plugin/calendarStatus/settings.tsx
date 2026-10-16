/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { Switch } from "@components/Switch";
import { classNameFactory } from "@utils/css";
import { OptionType, PluginNative } from "@utils/types";
import { useEffect, useState } from "@webpack/common";

import { CalendarState, CalEvent, DEFAULT_EMOJI, DEFAULT_TEXT, formatTime, occKey, Override, Overrides, resolveEvent, seriesKey, Status } from "./shared";

export const Native = VencordNative.pluginHelpers.CalendarStatus as PluginNative<typeof import("./native")>;

const cl = classNameFactory("vc-calstatus-");

const STATUSES: { value: Status; label: string; }[] = [
    { value: "dnd", label: "No molestar" },
    { value: "idle", label: "Ausente" },
    { value: "online", label: "En línea" },
    { value: "invisible", label: "Invisible" },
];

export const settings = definePluginSettings({
    agenda: {
        type: OptionType.COMPONENT,
        component: Agenda,
    },
    overrides: {
        type: OptionType.CUSTOM,
        default: {} as Overrides,
        description: "Overrides por evento (o:) y por serie (s:)",
    },
});

function setOverride(key: string, patch: Override | null) {
    // plain: los objetos del store son proxies y no se pueden clonar al guardar.
    const next: Overrides = { ...settings.plain.overrides };
    const merged: Record<string, unknown> = patch ? { ...next[key], ...patch } : {};
    // Vacío o undefined significa "sin override": se hereda de la serie o del valor por defecto.
    for (const k in merged) if (merged[k] === undefined || merged[k] === "") delete merged[k];

    if (Object.keys(merged).length) next[key] = merged;
    else delete next[key];

    settings.store.overrides = next;
    (Vencord.Plugins.plugins.CalendarStatus as any).runSync();
}

const dayLabel = (ms: number) => {
    const day = new Date(ms).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "short" });
    const today = new Date().toDateString();
    const tomorrow = new Date(Date.now() + 24 * 3600_000).toDateString();
    const d = new Date(ms).toDateString();
    return d === today ? `Hoy · ${day}` : d === tomorrow ? `Mañana · ${day}` : day;
};

function Editor({ event, overrides }: { event: CalEvent; overrides: Overrides; }) {
    const [scope, setScope] = useState<"series" | "occ">(event.recurring ? "series" : "occ");
    const key = scope === "series" ? seriesKey(event) : occKey(event);
    const own = overrides[key] ?? {};
    // Lo que se aplicaría sin este override, para mostrarlo como placeholder.
    const inherited = scope === "occ" ? overrides[seriesKey(event)] ?? {} : {};
    const set = (patch: Override) => setOverride(key, patch);

    return (
        <div className={cl("editor")}>
            {event.recurring && (
                <div className={cl("segmented")}>
                    <button className={cl({ selected: scope === "series" })} onClick={() => setScope("series")}>Toda la serie</button>
                    <button className={cl({ selected: scope === "occ" })} onClick={() => setScope("occ")}>Sólo esta vez</button>
                </div>
            )}

            <div className={cl("fields")}>
                <label className={cl("field", "field-emoji")}>
                    <span>Emoji</span>
                    <input
                        value={own.emoji ?? ""}
                        placeholder={inherited.emoji ?? DEFAULT_EMOJI}
                        onChange={e => set({ emoji: e.currentTarget.value.trim() })}
                    />
                </label>
                <label className={cl("field", "field-text")}>
                    <span>Texto</span>
                    <input
                        value={own.text ?? ""}
                        maxLength={128}
                        placeholder={inherited.text ?? DEFAULT_TEXT}
                        onChange={e => set({ text: e.currentTarget.value })}
                    />
                </label>
                <label className={cl("field")}>
                    <span>Desde</span>
                    <input type="time" value={own.start ?? ""} onChange={e => set({ start: e.currentTarget.value })} />
                </label>
                <label className={cl("field")}>
                    <span>Hasta</span>
                    <input type="time" value={own.end ?? ""} onChange={e => set({ end: e.currentTarget.value })} />
                </label>
            </div>

            <div className={cl("segmented")}>
                {STATUSES.map(s => (
                    <button
                        key={s.value}
                        className={cl({ selected: own.status === s.value })}
                        // Volver a pulsar el seleccionado quita el override.
                        onClick={() => set({ status: own.status === s.value ? undefined : s.value })}
                    >
                        <i className={cl("dot", `dot-${s.value}`)} />
                        {s.label}
                    </button>
                ))}
            </div>

            <div className={cl("editor-footer")}>
                <span>
                    <code>{"{titulo}"}</code> y <code>{"{hasta}"}</code> se sustituyen en el texto. Horas vacías = las del evento ({formatTime(event.start)}–{formatTime(event.end)}).
                </span>
                <button className={cl("reset")} disabled={!overrides[key]} onClick={() => setOverride(key, null)}>
                    Restablecer
                </button>
            </div>
        </div>
    );
}

function Row({ event, overrides, open, onToggleOpen }: { event: CalEvent; overrides: Overrides; open: boolean; onToggleOpen(): void; }) {
    const r = resolveEvent(event, overrides);
    const now = Date.now();
    const live = r.enabled && r.start <= now && now < r.end;
    const customized = !!(overrides[occKey(event)] || overrides[seriesKey(event)]);

    const toggle = (enabled: boolean) => {
        if (event.recurring) {
            // El interruptor de una recurrente actúa sobre la serie; la excepción puntual se quita para que surta efecto.
            setOverride(occKey(event), { enabled: undefined });
            setOverride(seriesKey(event), { enabled: enabled ? undefined : false });
        } else {
            setOverride(occKey(event), { enabled: enabled ? undefined : false });
        }
    };

    return (
        <div className={cl("row", { off: !r.enabled, live, open })} style={{ "--vc-calstatus-color": event.color } as React.CSSProperties}>
            <div className={cl("row-main")}>
                <button className={cl("row-body")} onClick={onToggleOpen}>
                    <span className={cl("time")}>
                        {formatTime(r.start)}
                        <small>{formatTime(r.end)}</small>
                    </span>
                    <span className={cl("info")}>
                        <span className={cl("title")}>
                            {event.title}
                            {event.recurring && <span className={cl("tag")} title="Evento recurrente">↻</span>}
                            {customized && <span className={cl("tag", "tag-custom")}>override</span>}
                            {live && <span className={cl("tag", "tag-live")}>ahora</span>}
                        </span>
                        <span className={cl("preview")}>
                            <i className={cl("dot", `dot-${r.status}`)} />
                            {r.enabled ? <>{r.emoji} {r.text}</> : "No cambia tu estado"}
                        </span>
                    </span>
                </button>
                <Switch checked={r.enabled} onChange={toggle} />
            </div>
            {open && <Editor event={event} overrides={overrides} />}
        </div>
    );
}

function Agenda() {
    const { overrides } = settings.use(["overrides"]);
    const [state, setState] = useState<CalendarState | null>();
    const [openId, setOpenId] = useState<string | null>(null);

    useEffect(() => {
        const load = () => Native.readState().then(setState);
        load();
        const interval = setInterval(load, 30_000);
        return () => clearInterval(interval);
    }, []);

    if (state === undefined) return null;
    if (!state?.events) return <div className={cl("empty")}>No hay datos del calendario. ¿Está corriendo el lector (<code>./install.sh</code>)?</div>;

    const now = Date.now();
    const days = new Map<string, CalEvent[]>();
    for (const e of state.events) {
        if (e.end <= now) continue;
        const label = dayLabel(e.start);
        days.set(label, [...days.get(label) ?? [], e]);
    }

    return (
        <div className={cl("agenda")}>
            <div className={cl("header")}>
                <strong>Próximos 7 días</strong>
                <span>Pulsa un evento para personalizar su estado</span>
            </div>
            <div className={cl("scroll")}>
                {days.size === 0 && <div className={cl("empty")}>Sin eventos con hora.</div>}
                {[...days].map(([label, events]) => (
                    <section key={label}>
                        <h4 className={cl("day")}>{label}</h4>
                        {events.map(e => (
                            <Row
                                key={e.id}
                                event={e}
                                overrides={overrides}
                                open={openId === e.id}
                                onToggleOpen={() => setOpenId(openId === e.id ? null : e.id)}
                            />
                        ))}
                    </section>
                ))}
            </div>
        </div>
    );
}
