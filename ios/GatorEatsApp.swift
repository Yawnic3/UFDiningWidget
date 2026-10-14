import SwiftUI
import WidgetKit

@main
struct GatorEatsApp: App {
    var body: some Scene {
        WindowGroup {
            FullMenuView()
        }
    }
}

struct FullMenuView: View {
    @State private var hall: DiningHall = .gatorCorner
    @State private var selected: Set<String> = ["Homestyle"]
    @State private var menu: DiningMenu?
    @State private var message: String?
    @State private var loading = false

    private let orange = Color(red: 1, green: 0.43, blue: 0.18)
    private var requestID: String {
        hall.rawValue + selected.sorted().joined(separator: "|")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("GOOD FOOD. LESS GUESSWORK.").font(.caption2.bold()).tracking(2).foregroundStyle(orange)
                        Text("What's cooking?").font(.largeTitle.bold())
                        Text("Pick your hall and favorite stations.").foregroundStyle(.secondary)
                    }
                    Picker("Dining hall", selection: Binding(get: { hall }, set: { newHall in
                        hall = newHall
                        selected = [newHall.stations[0]]
                    })) {
                        ForEach(DiningHall.allCases, id: \.self) { Text($0.title).tag($0) }
                    }.pickerStyle(.segmented)
                    VStack(spacing: 0) {
                        ForEach(hall.stations, id: \.self) { station in
                            Toggle(station, isOn: Binding(get: { selected.contains(station) }, set: { on in
                                if on { selected.insert(station) } else { selected.remove(station) }
                            })).padding(.vertical, 9).tint(orange)
                        }
                    }
                    if loading {
                        ProgressView("Getting your menu…").frame(maxWidth: .infinity).padding()
                    } else if let menu {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("YOUR STATIONS").font(.caption.bold()).tracking(2).foregroundStyle(orange)
                            Text(menu.meal).font(.title.bold())
                            Text(menu.date).font(.subheadline).foregroundStyle(.secondary)
                        }
                        ForEach(menu.stations) { station in
                            VStack(alignment: .leading, spacing: 12) {
                                Text(station.name).font(.headline)
                                Text(station.serviceLabel).font(.subheadline).foregroundStyle(orange)
                                if station.items.isEmpty { Text("Menu not published for this station.").foregroundStyle(.secondary) }
                                ForEach(Array(station.items.enumerated()), id: \.offset) { _, item in
                                    Text(item).frame(maxWidth: .infinity, alignment: .leading)
                                }
                            }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
                        }
                        if let missing = menu.unavailableStations, !missing.isEmpty {
                            Text("Menu unavailable: " + missing.joined(separator: ", ")).font(.subheadline).foregroundStyle(.secondary)
                        }
                    } else if let message {
                        Label(message, systemImage: "fork.knife").foregroundStyle(.secondary).padding(.vertical)
                    }
                    Button("Refresh menu") { Task { await refresh() } }.buttonStyle(.borderedProminent).tint(orange).disabled(loading || selected.isEmpty)
                    Text("Configure each widget by touching and holding it, then choosing Edit Widget.").font(.footnote).foregroundStyle(.secondary)
                }.padding(24)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Gator Eats").navigationBarTitleDisplayMode(.inline)
            .task(id: requestID) { await refresh() }
            .onOpenURL { url in
                guard url.scheme == "gatoreats", url.host == "menu",
                      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                      let rawHall = components.queryItems?.first(where: { $0.name == "hall" })?.value,
                      let newHall = DiningHall(rawValue: rawHall) else { return }
                hall = newHall
                let values = components.queryItems?.first(where: { $0.name == "stations" })?.value?.components(separatedBy: ",") ?? []
                selected = Set(values.filter { newHall.stations.contains($0) })
                if selected.isEmpty { selected = [newHall.stations[0]] }
            }
        }
    }
    @MainActor private func refresh() async {
        let requested = requestID
        guard !selected.isEmpty else {
            loading = false
            menu = nil
            message = "Select at least one station."
            return
        }
        loading = true
        menu = nil
        message = nil

        do {
            let result = try await MenuClient.load(hall: hall, stations: selected.sorted())
            guard !Task.isCancelled, requested == requestID else { return }
            menu = result
            WidgetCenter.shared.reloadTimelines(ofKind: "GatorEats")
        } catch {
            guard !Task.isCancelled, requested == requestID else { return }
            message = error.localizedDescription
        }
        loading = false
    }
}
