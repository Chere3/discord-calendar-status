/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type Status = "online" | "idle" | "dnd" | "invisible";

export interface CalEvent {
    /** Único por repetición */
    id: string;
    /** Común a todas las repeticiones de un evento recurrente */
    seriesId: string;
    recurring: boolean;
    title: string;
    start: number;
    end: number;
    calendar: string;
    color: string;
}

export interface CalendarState {
    updatedAt: number;
    events: CalEvent[];
}

export interface Override {
    enabled?: boolean;
    /** Admite {titulo} y {hasta} */
    text?: string;
    emoji?: string;
    status?: Status;
    /** HH:MM, sobre el día del evento */
    start?: string;
    end?: string;
}

export type Overrides = Record<string, Override>;

export interface Resolved {
    enabled: boolean;
    start: number;
    end: number;
    text: string;
    emoji: string;
    status: Status;
}

export const DEFAULT_TEXT = "{titulo} hasta {hasta}";
export const DEFAULT_EMOJI = "📅";
export const DEFAULT_STATUS: Status = "dnd";

export const occKey = (e: CalEvent) => `o:${e.id}`;
export const seriesKey = (e: CalEvent) => `s:${e.seriesId}`;

export const formatTime = (ms: number) =>
    new Date(ms).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });

function applyTime(base: number, hhmm: string | undefined) {
    if (!hhmm) return base;
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(base).setHours(h, m, 0, 0);
}

/** Aplica los overrides: el de la repetición concreta gana al de la serie. */
export function resolveEvent(e: CalEvent, overrides: Overrides): Resolved {
    const o = { ...overrides[seriesKey(e)], ...overrides[occKey(e)] };
    const end = applyTime(e.end, o.end);

    return {
        enabled: o.enabled ?? true,
        start: applyTime(e.start, o.start),
        end,
        text: (o.text || DEFAULT_TEXT).replaceAll("{titulo}", e.title).replaceAll("{hasta}", formatTime(end)).slice(0, 128),
        emoji: o.emoji || DEFAULT_EMOJI,
        status: o.status ?? DEFAULT_STATUS,
    };
}
