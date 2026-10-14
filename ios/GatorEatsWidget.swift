import SwiftUI
import WidgetKit

struct MenuEntry: TimelineEntry {
    let date: Date
    let hall: DiningHall
    let stations: [String]
    let menu: DiningMenu?
    let message: String?
}
struct MenuProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> MenuEntry {
        MenuEntry(date: .now, hall: .gatorCorner, stations: [], menu: nil, message: "Your next meal, at a glance.")
    }
    func snapshot(for configuration: MenuConfiguration, in context: Context) async -> MenuEntry {
        if context.isPreview { return placeholder(in: context) }
        return await entry(configuration)
    }
    private func entry(_ config: MenuConfiguration) async -> MenuEntry {
        do {
            let menu = try await MenuClient.load(hall: config.hall, stations: config.stations)
            return MenuEntry(date: .now, hall: config.hall, stations: config.stations, menu: menu, message: nil)
        } catch {
            return MenuEntry(date: .now, hall: config.hall, stations: config.stations, menu: nil, message: error.localizedDescription)
        }
    }
    func timeline(for configuration: MenuConfiguration, in context: Context) async -> Timeline<MenuEntry> {
        let current = await entry(configuration)
        let retry = Date.now.addingTimeInterval(15 * 60)
        guard let transition = current.menu?.nextTransitionAt, transition > .now else {
            return Timeline(entries: [current], policy: .after(retry))
        }
        // Expire the old menu at the boundary, even if WidgetKit delays the network refresh.
        let expired = MenuEntry(date: transition, hall: current.hall, stations: current.stations, menu: nil, message: "Meal changing. Open for the latest menu.")
        return Timeline(entries: [current, expired], policy: .after(min(transition, retry)))
    }
}

struct MenuWidgetView: View {
    let entry: MenuEntry
    @Environment(\.widgetFamily) private var family
    private let navy = Color(red: 0.06, green: 0.15, blue: 0.27)
    private let orange = Color(red: 1, green: 0.43, blue: 0.18)
    var body: some View {
        Group {
            if family == .accessoryRectangular {
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.hall.title).font(.headline)
                    if let menu = entry.menu, entry.date < menu.nextTransitionAt {
                        Text(menu.stations.first?.serviceLabel ?? "Menu unavailable").font(.caption)
                        Text(menu.stations.flatMap(\.items).prefix(2).joined(separator: " · ")).font(.caption).lineLimit(1)
                    } else {
                        Text("Open for menu").font(.caption)
                    }
                }
            } else {
                home
            }
        }
        .widgetURL(MenuClient.link(hall: entry.hall, stations: entry.stations))
        .containerBackground(for: .widget) {
            LinearGradient(colors: [navy, Color(red: 0.10, green: 0.23, blue: 0.36)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }
    private var home: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("GATOR EATS").font(.system(size: 9, weight: .heavy, design: .rounded)).tracking(2).foregroundStyle(orange)
                    Text(entry.hall.title).font(.system(.headline, design: .rounded)).foregroundStyle(.white)
                }
                Spacer(minLength: 4)
                if let menu = entry.menu {
                    Text("STATION MENUS")
                        .font(.system(size: 9, weight: .bold)).padding(.horizontal, 8).padding(.vertical, 5)
                        .background(orange.opacity(0.18), in: Capsule()).foregroundStyle(Color.white)
                }
            }
            if let menu = entry.menu, entry.date < menu.nextTransitionAt {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(Array(menu.stations.prefix(2))) { station in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(station.name).font(.system(size: 11, weight: .semibold)).foregroundStyle(orange).lineLimit(1)
                            Text(station.serviceLabel).font(.system(size: 9)).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                            if station.items.isEmpty { Text("Menu unavailable").font(.caption).foregroundStyle(.white.opacity(0.7)) }
                            ForEach(Array(station.items.prefix(3).enumerated()), id: \.offset) { _, item in
                                Text(item).font(.system(size: 12)).foregroundStyle(.white).lineLimit(1)
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if menu.stations.isEmpty {
                        Text("Your stations have no published menu yet.").font(.caption).foregroundStyle(.white.opacity(0.8))
                    }
                }
                Spacer(minLength: 0)
                HStack {
                    Text(menu.date).font(.system(size: 9)).foregroundStyle(.white.opacity(0.6))
                    Spacer()
                    Text("Full menu ↗").font(.system(size: 10, weight: .medium)).foregroundStyle(.white.opacity(0.8))
                }
            } else {
                Spacer(minLength: 0)
                Label(entry.message ?? "Loading menu…", systemImage: "fork.knife")
                    .font(.caption).foregroundStyle(.white.opacity(0.8)).lineLimit(3)
                Spacer(minLength: 0)
                Text("Tap to open Gator Eats ↗").font(.system(size: 10)).foregroundStyle(orange)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

@main
struct GatorEatsWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "GatorEats", intent: MenuConfiguration.self, provider: MenuProvider()) { entry in
            MenuWidgetView(entry: entry)
        }
        .configurationDisplayName("Gator Eats")
        .description("Your favorite stations. Your next meal.")
        .supportedFamilies([.systemMedium, .accessoryRectangular])
    }
}
