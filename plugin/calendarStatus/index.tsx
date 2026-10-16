/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { getUserSettingLazy } from "@api/UserSettings";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";

import { Native, settings } from "./settings";
import { DEFAULT_EMOJI, DEFAULT_STATUS, Overrides, resolveEvent, Status } from "./shared";

interface CustomStatus {
    text: string;
    emojiId: string;
    emojiName: string;
    expiresAtMs: string;
}

// Lo que había antes del bloque y lo que pusimos nosotros, para restaurar sin pisar cambios manuales.
interface Saved {
    prevStatus: string;
    prevCustom: CustomStatus | undefined;
    setText: string;
    setEmoji?: string;
    setStatus?: Status;
    /** Cuándo terminó el bloque; el registro se conserva un rato para vigilar que la restauración no se revierta. */
    endedAt?: number;
}

const logger = new Logger("CalendarStatus");

const StatusSetting = getUserSettingLazy<string>("status", "status")!;
const CustomStatusSetting = getUserSettingLazy<CustomStatus | undefined>("status", "customStatus")!;

const SAVED_KEY = "CalendarStatus_saved";
const POLL_MS = 30_000;
// Si el lector de calendario lleva más que esto sin escribir, no tocamos nada.
const STALE_MS = 5 * 60_000;
const DAY_MS = 24 * 3600_000;
const SYNC_TIMEOUT_MS = 20_000;
// Tras terminar un bloque seguimos comprobando este tiempo que el tipo de conexión quedó restaurado.
const RESTORE_GRACE_MS = 3 * 60_000;

// Deja rastro en ~/Library/Logs/discord-calendar-status.log para poder diagnosticar sin DevTools.
function log(...parts: unknown[]) {
    logger.info(...parts);
    Native.log(parts.map(String).join(" ")).catch(() => { });
}

let interval: ReturnType<typeof setInterval> | undefined;

// Los overrides de repeticiones ya pasadas no sirven; la fecha va al final de la clave.
function pruneOverrides(now: number) {
    const { overrides }: { overrides: Overrides; } = settings.plain;
    const stale = Object.keys(overrides).filter(k => k.startsWith("o:") && Number(k.slice(k.lastIndexOf("|") + 1)) < now - 2 * DAY_MS);
    if (!stale.length) return;

    const next = { ...overrides };
    for (const k of stale) delete next[k];
    settings.store.overrides = next;
}

async function sync() {
    const state = await Native.readState();
    const now = Date.now();
    if (!state?.events || now - state.updatedAt > STALE_MS) return;

    pruneOverrides(now);

    // Si hay varios bloques a la vez, manda el que termina más tarde.
    const current = state.events
        .map(e => resolveEvent(e, settings.store.overrides))
        .filter(r => r.enabled && r.start <= now && now < r.end)
        .sort((a, b) => b.end - a.end)[0];
    const saved = await DataStore.get<Saved>(SAVED_KEY);

    if (current) {
        const { text, emoji, status } = current;
        if (saved && !saved.endedAt && saved.setText === text && (saved.setEmoji ?? DEFAULT_EMOJI) === emoji && (saved.setStatus ?? DEFAULT_STATUS) === status) return;

        const currentStatus = StatusSetting.getSetting();
        // Invisible se respeta: no forzamos a aparecer conectado.
        if (!saved && currentStatus === "invisible") return;

        await DataStore.set(SAVED_KEY, {
            prevStatus: saved?.prevStatus ?? currentStatus,
            prevCustom: saved ? saved.prevCustom : CustomStatusSetting.getSetting(),
            setText: text,
            setEmoji: emoji,
            setStatus: status,
        } satisfies Saved);
        await StatusSetting.updateSetting(status);
        // expiresAtMs hace que Discord lo borre solo aunque Vesktop se cierre.
        await CustomStatusSetting.updateSetting({ text, emojiId: "0", emojiName: emoji, expiresAtMs: String(current.end) });
        log("Bloque:", emoji, text, `(${status}, antes ${saved?.prevStatus ?? currentStatus})`);
    } else if (saved) {
        const setStatus = saved.setStatus ?? DEFAULT_STATUS;
        const stillOurs = StatusSetting.getSetting() === setStatus && saved.prevStatus !== setStatus;

        if (!saved.endedAt) {
            // Primero se restaura y después se anota: si algo falla, el siguiente ciclo reintenta.
            if (stillOurs) await StatusSetting.updateSetting(saved.prevStatus);

            const custom = CustomStatusSetting.getSetting();
            if (!custom || custom.text === saved.setText) {
                const prev = saved.prevCustom;
                const expired = prev && prev.expiresAtMs !== "0" && Number(prev.expiresAtMs) <= now;
                await CustomStatusSetting.updateSetting(expired ? undefined : prev);
            }
            await DataStore.set(SAVED_KEY, { ...saved, endedAt: now } satisfies Saved);
            log("Bloque terminado:", stillOurs ? `${setStatus} → ${saved.prevStatus}` : "tipo de conexión cambiado a mano, no se toca");
        } else if (stillOurs) {
            // Otro cliente (Discord.app, el celular) puede reescribir el estado al caducar el texto.
            await StatusSetting.updateSetting(saved.prevStatus);
            log("La restauración se había revertido; reaplicado", saved.prevStatus);
        } else if (now - saved.endedAt > RESTORE_GRACE_MS) {
            await DataStore.del(SAVED_KEY);
        }
    }
}

// Las ejecuciones se encadenan para que un cambio en la config no se cruce con el sondeo.
// El límite de tiempo evita que una llamada colgada bloquee la cola para siempre.
let queue = Promise.resolve();
let lastRun = Date.now();
const runSync = () => queue = queue
    .then(() => {
        const gap = Date.now() - lastRun;
        lastRun = Date.now();
        if (gap > 3 * POLL_MS) log(`Ciclo retrasado ${Math.round(gap / 1000)} s`);

        return Promise.race([
            sync(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("sync no terminó a tiempo")), SYNC_TIMEOUT_MS)),
        ]);
    })
    .catch(e => log("Error:", e));

export default definePlugin({
    name: "CalendarStatus",
    description: "Pone el evento en curso del calendario como estado de Discord, con overrides por evento o serie",
    authors: [{ name: "Diego", id: 0n }],
    dependencies: ["UserSettingsAPI"],
    settings,

    start() {
        log("Plugin iniciado");
        runSync();
        interval = setInterval(runSync, POLL_MS);
    },

    stop() {
        clearInterval(interval);
    },

    // Lo llama la pantalla de config para aplicar al momento.
    runSync,
});
