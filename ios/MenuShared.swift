import Foundation
import AppIntents

// Shared by the application and widget extension targets.
enum DiningHall: String, AppEnum, CaseIterable {
    case gatorCorner = "gator-corner"
    case broward = "broward"
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Dining hall"
    static var caseDisplayRepresentations: [DiningHall: DisplayRepresentation] = [
        .gatorCorner: "Gator Corner", .broward: "Broward Dining"
    ]
    var title: String {
        self == .gatorCorner ? "Gator Corner" : "Broward Dining"
    }

    var stations: [String] {
        self == .gatorCorner
        ? ["Homestyle", "500 Degrees", "Grill Works", "Delicious Without", "Global Flame"]
        : ["Taste of Home", "Delicious Without", "Gator Grill"]
    }
}

struct StationOptions: DynamicOptionsProvider {
    @IntentParameterDependency<MenuConfiguration>(\.$hall) var configuration
    func results() async throws -> [String] {
        (configuration?.hall ?? .gatorCorner).stations
    }
}

struct MenuConfiguration: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Your dining menu"
    static var description = IntentDescription("Choose a hall and the stations you want to see.")

    @Parameter(title: "Dining hall", default: .gatorCorner) var hall: DiningHall

    @Parameter(title: "Stations", optionsProvider: StationOptions()) var stations: [String]
}

struct MenuStation: Identifiable {
    let name: String
    let items: [String]
    let serviceLabel: String

    var id: String {
        name
    }
}

struct StationMeal: Decodable {
    let meal: String
    let date: String
    let startsAt: Date
    let endsAt: Date
    let scheduleSource: String
    let availability: String
    let items: [String]
}

struct StationService: Decodable {
    let name: String
    let status: String
    let current: StationMeal?
    let next: StationMeal?

    var display: MenuStation {
        if let current {
            let label = current.availability == "available"
                ? "Now · \(current.meal.capitalized)"
                : "\(current.meal.capitalized) · menu unavailable"

            return MenuStation(name: name, items: current.items, serviceLabel: label)
        }

        if let next {
            return MenuStation(
                name: name,
                items: next.items,
                serviceLabel: "Next · \(next.meal.capitalized)"
            )
        }

        return MenuStation(name: name, items: [], serviceLabel: status == "closed" ? "Closed" : "Menu unavailable")
    }
}

struct DiningMenu: Decodable {
    let hall: String
    let date: String
    private let transition: Date?
    private let services: [StationService]

    enum CodingKeys: String, CodingKey {
        case hall, date
        case transition = "nextTransitionAt"
        case services = "stations"
    }

    var nextTransitionAt: Date {
        transition ?? Date.now.addingTimeInterval(15 * 60)
    }

    var stations: [MenuStation] {
        services.map(\.display)
    }

    var meal: String {
        "Station menus"
    }

    var isCurrentlyServing: Bool {
        services.contains { $0.status == "serving" }
    }

    var unavailableStations: [String]? {
        services.filter { $0.current?.availability == "unavailable" ||
            ($0.current == nil && $0.next?.availability == "unavailable") }.map(\.name)
    }
}

struct MenuFailure: Decodable {
    struct Detail: Decodable {
        let message: String
    }

    let error: Detail
}

struct MenuClient {
    static func load(hall: DiningHall, stations: [String]) async throws -> DiningMenu {
        guard !stations.isEmpty, stations.allSatisfy({ hall.stations.contains($0) }) else {
            throw MessageError(message: "Choose stations for this dining hall in Edit Widget.")
        }
        guard let base = Bundle.main.object(forInfoDictionaryKey: "GatorEatsAPIBaseURL") as? String,
              let baseURL = URL(string: base), baseURL.scheme == "https" else {
            throw MessageError(message: "Set up the secure menu server to get started.")
        }
        var url = URLComponents(url: baseURL.appendingPathComponent("api/menu/current"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "hall", value: hall.rawValue), URLQueryItem(name: "stations", value: stations.joined(separator: ","))]
        var request = URLRequest(url: url.url!)
        request.timeoutInterval = 15
        request.cachePolicy = .reloadIgnoringLocalCacheData

        let (data, response) = try await URLSession.shared.data(for: request)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        guard let response = response as? HTTPURLResponse, response.statusCode == 200 else {
            let failure = try? decoder.decode(MenuFailure.self, from: data)
            throw MessageError(message: failure?.error.message ?? "Menu unavailable. Please try again later.")
        }

        return try decoder.decode(DiningMenu.self, from: data)
    }

    static func link(hall: DiningHall, stations: [String]) -> URL {
        var url = URLComponents()
        url.scheme = "gatoreats"
        url.host = "menu"
        url.queryItems = [URLQueryItem(name: "hall", value: hall.rawValue), URLQueryItem(name: "stations", value: stations.joined(separator: ","))]
        return url.url!
    }
}

struct MessageError: LocalizedError {
    let message: String

    var errorDescription: String? {
        message
    }
}
