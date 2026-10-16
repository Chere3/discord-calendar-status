// Lee los eventos de los próximos 7 días de Calendar.app (EventKit) y los escribe
// en state.json para que lo consuma el plugin de Vencord.
import EventKit
import Foundation

let carpeta = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/discord-calendar-status")
let salida = carpeta.appendingPathComponent("state.json")

// Títulos de los calendarios a leer, tal como aparecen en Calendar.app. Sin config.json se leen todos.
struct Config: Decodable { let calendarios: [String] }
let calendarios: Set<String>? = (try? Data(contentsOf: carpeta.appendingPathComponent("config.json")))
    .flatMap { try? JSONDecoder().decode(Config.self, from: $0) }
    .map { Set($0.calendarios) }

let store = EKEventStore()
let semaforo = DispatchSemaphore(value: 0)
var permitido = false
store.requestFullAccessToEvents { ok, _ in
    permitido = ok
    semaforo.signal()
}
semaforo.wait()
guard permitido else {
    FileHandle.standardError.write("Sin permiso de Calendarios (Ajustes del Sistema > Privacidad > Calendarios)\n".data(using: .utf8)!)
    exit(1)
}

let ahora = Date()
let inicio = Calendar.current.startOfDay(for: ahora)
let fin = inicio.addingTimeInterval(7 * 24 * 3600)
let elegidos = store.calendars(for: .event).filter { calendarios?.contains($0.title) ?? true }

func ms(_ fecha: Date) -> Int { Int(fecha.timeIntervalSince1970 * 1000) }

func hex(_ color: CGColor?) -> String {
    guard let c = color?.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil)?.components, c.count >= 3 else { return "#888888" }
    return String(format: "#%02x%02x%02x", Int(c[0] * 255), Int(c[1] * 255), Int(c[2] * 255))
}

// Eventos con hora de hoy a 7 días; el plugin decide cuál está en curso y aplica los overrides.
let eventos: [[String: Any]] = store.events(matching: store.predicateForEvents(withStart: inicio, end: fin, calendars: elegidos))
    .filter { evento in
        let rechazado = evento.attendees?.contains { $0.isCurrentUser && $0.participantStatus == .declined } ?? false
        return !evento.isAllDay && !rechazado
    }
    .sorted { $0.startDate < $1.startDate }
    .map { evento in
        // eventIdentifier es común a toda la serie; la fecha original distingue cada repetición.
        let serie = evento.eventIdentifier ?? evento.calendarItemIdentifier
        let ocurrencia: Date? = evento.occurrenceDate
        return [
            "id": "\(serie)|\(ms(ocurrencia ?? evento.startDate))",
            "seriesId": serie,
            "recurring": evento.hasRecurrenceRules,
            "title": evento.title ?? "Ocupado",
            "start": ms(evento.startDate),
            "end": ms(evento.endDate),
            "calendar": evento.calendar.title,
            "color": hex(evento.calendar.cgColor),
        ]
    }

let estado: [String: Any] = ["updatedAt": ms(ahora), "events": eventos]

try FileManager.default.createDirectory(at: salida.deletingLastPathComponent(), withIntermediateDirectories: true)
try JSONSerialization.data(withJSONObject: estado).write(to: salida, options: .atomic)
