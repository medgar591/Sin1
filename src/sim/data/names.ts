import type { Industry } from '../types';

export const FIRST_NAMES: string[] = [
  // East Asian
  "Hiroshi", "Yuki", "Kenji", "Haruka", "Sota", "Mei", "Jun", "Wei", "Lin", "Xiaoyu",
  "Haoran", "Yifan", "Ji-woo", "Min-jun", "Seo-yeon", "Ha-eun", "Dae-ho", "Soo-ah", "Takumi", "Aiko",
  "Ren", "Nozomi", "Kaito", "Sakura", "Riku", "Emi", "Daichi", "Mizuki", "Chen", "Qiang",
  "Meilin", "Zhen", "Ayaka", "Hana", "Tomoko", "Ryo", "Shun", "Ting", "Yan", "Jae-hyun",
  "Eun-ji", "Kei", "Naoki", "Ling", "Bo", "Jiro", "Akari", "Tae-yang", "Yoshiko", "Hideo",
  // South Asian
  "Aarav", "Priya", "Rohan", "Ananya", "Vikram", "Meera", "Arjun", "Kavya", "Dev", "Ishaan",
  "Lakshmi", "Rajan", "Nisha", "Sanjay", "Farah", "Imran", "Zara", "Tariq", "Anjali", "Kiran",
  "Devika", "Sunil", "Gauri", "Nikhil", "Tara", "Hari", "Ravi", "Pooja", "Dhruv", "Sana",
  "Bhavna", "Ashwin", "Lalitha", "Yash", "Suresh", "Ritu", "Manoj", "Shreya", "Faisal", "Nadia",
  // African
  "Amara", "Kwame", "Thandiwe", "Kofi", "Ngozi", "Chidi", "Zawadi", "Sipho", "Abebe", "Makena",
  "Tendai", "Ayodele", "Nia", "Kojo", "Adaeze", "Themba", "Wanjiru", "Bongani", "Fatou", "Oluwaseun",
  "Yaa", "Sekou", "Lerato", "Ifeoma", "Jabari", "Nkem", "Mariam", "Tsehay", "Kagiso", "Efua",
  "Obinna", "Zuri", "Dumisani", "Aminata", "Mandla", "Chinwe", "Nuru", "Baraka", "Ama", "Tafari",
  // Latin American
  "Mateo", "Valentina", "Santiago", "Camila", "Diego", "Lucía", "Joaquín", "Ximena", "Rafael", "Itzel",
  "Tomás", "Paloma", "Emiliano", "Renata", "Gael", "Marisol", "Facundo", "Cecilia", "Ignacio", "Jimena",
  "Bruno", "Lourdes", "Nicolás", "Yara", "Esteban", "Antonella", "Rodrigo", "Dulce", "Benicio", "Guadalupe",
  "Ana", "Pedro", "Xochitl", "Itzayana", "Sebastián", "Florencia", "Ramiro", "Catalina", "Tadeo", "Mireya",
  // European
  "Elena", "Lukas", "Freya", "Anouk", "Matteo", "Sofia", "Henrik", "Ingrid", "Declan", "Siobhán",
  "Aoife", "Giulia", "Bram", "Liesbeth", "Émile", "Chiara", "Oskar", "Marta", "Felix", "Greta",
  "Ilse", "Thea", "Rhys", "Gwen", "Corentin", "Mireille", "Stellan", "Niamh", "Tobias", "Helga",
  "Anselm", "Odile", "Piet", "Dagny", "Lotte", "Leopold", "Vera", "Julian", "Amélie", "Ewan",
  // Slavic
  "Dmitri", "Anya", "Piotr", "Katarzyna", "Mikhail", "Zoryana", "Tomasz", "Milena", "Vadim", "Oksana",
  "Bogdan", "Radoslav", "Svetlana", "Zdenek", "Yaroslav", "Lyubov", "Stanislav", "Agnieszka", "Vesna", "Ilya",
  "Dragana", "Borys", "Miroslava", "Yevgenia", "Rostislav", "Ksenia", "Danica", "Andrej", "Halyna", "Vasil",
  // Middle Eastern
  "Layla", "Yusuf", "Nour", "Karim", "Samira", "Idris", "Leila", "Rami", "Yasmin", "Tamer",
  "Zainab", "Faris", "Dalia", "Amir", "Hadi", "Shirin", "Darius", "Nasrin", "Ilan", "Saeed",
  "Rania", "Khalil", "Noor", "Bahar", "Malak", "Adel", "Farida", "Omar", "Elif", "Deniz",
  // Pacific and Indigenous
  "Kai", "Mere", "Lani", "Tane", "Ailani", "Kekoa", "Hine", "Manu", "Malia", "Tui",
  "Ngaio", "Keoni", "Wiremu", "Teuila", "Kaimana", "Nalani", "Tahu", "Aroha", "Koa", "Ngaire",
];

export const LAST_NAMES: string[] = [
  // Japanese
  "Hoshida", "Tanabe", "Mori", "Kuroda", "Ishikawa", "Nakamura", "Aoyama", "Fujimaki", "Sato", "Takeda",
  "Ueno", "Kishi", "Hayashi", "Shimizu", "Okada", "Yamazaki", "Matsuda", "Kobayashi", "Watanabe", "Ono",
  "Saito", "Hasegawa", "Nishimura", "Iwata", "Kaneko", "Noguchi", "Sakamoto", "Torii", "Ichikawa", "Harada",
  "Fukuda", "Tachibana", "Yorimitsu", "Kuroiwa", "Iseki", "Okuyama", "Shimaoka", "Kagetsu", "Yanagisawa",
  // Chinese
  "Wang", "Li", "Zhang", "Chen", "Liu", "Yang", "Huang", "Zhou", "Wu", "Xu",
  "Lin", "Gao", "Deng", "Shen", "Tang", "Qian", "Cao", "Feng", "Ye", "Lu",
  // Korean
  "Kim", "Park", "Choi", "Jung", "Kang", "Yoon", "Han", "Seo", "Oh", "Shin",
  "Baek", "Ryu", "Hwang", "Ahn", "Song", "Jeon",
  // Vietnamese
  "Nguyen", "Tran", "Pham", "Vu", "Dang", "Bui", "Do", "Ngo",
  // Filipino
  "Dela Cruz", "Villanueva", "Mendoza", "Bautista", "Aquino", "Santos", "Velasco", "Macaraeg",
  // South Asian
  "Patel", "Sharma", "Iyer", "Reddy", "Mehta", "Chopra", "Banerjee", "Krishnan", "Gupta", "Joshi",
  "Nair", "Desai", "Malhotra", "Rao", "Bhatt", "Kapoor", "Menon", "Saxena", "Chatterjee", "Thakur",
  "Khan", "Ahmed", "Siddiqui", "Qureshi", "Hussain", "Ansari", "Rahman", "Mirza", "Fernando", "Perera",
  "Silva", "Wickramasinghe", "Bose", "Pillai", "Trivedi", "Deshpande", "Kulkarni", "Shah", "Dasgupta", "Rathore",
  // African
  "Okafor", "Adeyemi", "Mensah", "Abara", "Nkosi", "Dlamini", "Mahlangu", "Kamau", "Otieno", "Mwangi",
  "Ndlovu", "Achebe", "Okonkwo", "Boateng", "Asante", "Diallo", "Traoré", "Keita", "Ba", "Sow",
  "Ouédraogo", "Koné", "Tesfaye", "Haile", "Abubakar", "Bello", "Eze", "Nwosu", "Owusu", "Amoah",
  "Mutua", "Njoroge", "Kipkemboi", "Mokoena", "Sithole", "Dube", "Moyo", "Chirwa", "Banda", "Phiri",
  // Latin American
  "García", "Rodríguez", "Martínez", "López", "Hernández", "González", "Pérez", "Sánchez", "Ramírez", "Torres",
  "Flores", "Rivera", "Gómez", "Díaz", "Cruz", "Morales", "Ortiz", "Gutiérrez", "Chávez", "Ruiz",
  "Vargas", "Castillo", "Méndez", "Salazar", "Quintero", "Ocampo", "Villalobos", "Estrada", "Carvajal", "Peña",
  "Arce", "Zavala", "Montoya", "Lozano", "Ibarra", "Cordero", "Paz", "Osorio", "Fuentes", "Aranda",
  "Iglesias", "Maldonado", "Espinoza", "Benítez", "Acosta", "Figueroa", "Valdés", "Solís", "Yazzie", "Begay",
  // Portuguese and Brazilian
  "Oliveira", "Souza", "Costa", "Ferreira", "Almeida", "Carvalho", "Lima", "Araújo", "Barbosa", "Ribeiro",
  "Nascimento", "Moreira", "Teixeira", "Cardoso", "Monteiro", "Duarte", "Pinheiro", "Vieira", "Tsosie", "Mendes",
  // Western European
  "Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Becker", "Hoffmann", "Koch", "Richter", "Klein",
  "Wolf", "Neumann", "Braun", "Keller", "Hartmann", "Vogt", "Brandt", "Eckert", "Lindqvist", "Johansson",
  "Andersen", "Nilsen", "Halvorsen", "Sørensen", "Virtanen", "Korhonen", "Berglund", "Strand", "Dubois", "Lefebvre",
  "Moreau", "Laurent", "Girard", "Bonnet", "Rousseau", "Mercier", "Fontaine", "Caron", "Rossi", "Ferrari",
  "Esposito", "Bianchi", "Romano", "Colombo", "Ricci", "Marino", "Greco", "De Luca", "Murphy", "O'Brien",
  "Walsh", "Byrne", "Keane", "MacLeod", "Ferguson", "Whitfield", "Ashworth", "Thorne", "Pemberton", "Vance",
  // Slavic and Eastern European
  "Kowalczyk", "Nowak", "Wiśniewski", "Wójcik", "Kamiński", "Lewandowski", "Zieliński", "Szymański", "Dąbrowski", "Kozak",
  "Horvat", "Novak", "Kovač", "Petrović", "Jovanović", "Dvořák", "Svoboda", "Novotný", "Papadopoulos", "Georgiou",
  "Dimitrov", "Ivanova", "Ivanov", "Petrov", "Sokolov", "Volkov", "Kuznetsov", "Smirnova", "Popova", "Morozov",
  "Lebedev", "Orlov", "Zhukov", "Shevchenko", "Bondarenko", "Tkachenko", "Melnyk", "Kovalenko", "Savchuk", "Babenko",
  // Middle Eastern
  "Haddad", "Khoury", "Nasser", "Saleh", "Aziz", "Mansour", "Rahimi", "Karimi", "Moradi", "Hosseini",
  "Ahmadi", "Azizi", "Jaber", "Darwish", "Suleiman", "Yousef", "Kassab", "Nassar", "Sabbagh", "Ghorbani",
  "Yılmaz", "Kaya", "Demir", "Çelik", "Şahin", "Aksoy", "Doğan", "Öztürk", "Tehrani", "Abadi",
  // Jewish and other
  "Kaplan", "Levy", "Cohen", "Friedman", "Rosenberg", "Shapiro", "Adler", "Haas", "Ben-David", "Mizrahi",
  // Pacific and Indigenous
  "Kealoha", "Tupou", "Faleolo", "Parata", "Rangi", "Te Aho", "Ngata", "Kaho", "Lagi", "Mahuika",
  "Taufa", "Solomona", "Pulu", "Kaimana", "Begaye", "Nakoa", "Malo", "Waititi", "Kanahele", "Hohepa",
];

export const UPLIFT_NAMES: string[] = [
  "Bruno", "Juniper", "Biscuit", "Marlowe", "Clover", "Tobin", "Ansel", "Mabel", "Pippa", "Otis",
  "Hazel", "Rufus", "Winnow", "Gus", "Odile", "Sable", "Brindle", "Tuck", "Fennick", "Moss",
  "Duffy", "Pomeroy", "Kip", "Lumen", "Bramble", "Ferris", "Hobb", "Dunmore", "Oakley", "Thistle",
  "Rook", "Saffron", "Wren", "Gilbert", "Bodhi", "Nessa", "Cleo", "Teodor", "Anzu", "Koda",
  "Mochi", "Ember", "Halvard", "Doris", "Pilar", "Tansy", "Hollis", "Rasmus", "Yarrow", "Milo",
];

export const SYNTH_DESIGNATIONS: string[] = [
  "KX", "Halden-", "Mira", "ORI-", "Tessaly-", "VX", "Calloway-", "Nyx-", "Sable-", "Quill-",
  "Veda", "Prax-", "Lumo-", "Dekka-", "Ansel-", "Tavi-", "Ravel-", "Oriel-", "SR", "Mosaic-",
  "Hesper-", "Ilex-", "Caro-", "Vanta-", "Ondine", "Zephra", "Brisk-", "Corva-", "Nimbus-", "Teodora-",
];

export const TEAM_CODENAMES: string[] = [
  // Birds
  "Kestrel", "Heron", "Merlin", "Osprey", "Harrier", "Shrike", "Egret", "Plover", "Curlew", "Dunlin",
  "Tern", "Gannet", "Ibis", "Kite", "Lapwing", "Nightjar", "Oriole", "Peregrine", "Redstart", "Sanderling",
  "Swift", "Falcon", "Bittern", "Goshawk", "Cormorant", "Pipit", "Starling", "Kittiwake",
  // Tools
  "Awl", "Chisel", "Plane", "Gimlet", "Bevel", "Lathe", "Rasp", "Trowel", "Caliper", "Ratchet",
  "Spindle", "Anvil", "Tongs", "Sledge", "Adze", "Auger", "Mallet", "Gouge", "Plumb", "Spokeshave",
  // Nautical
  "Halyard", "Bowsprit", "Binnacle", "Capstan", "Keel", "Tiller", "Transom", "Windlass", "Gunwale", "Shackle",
  "Cleat", "Bollard", "Fathom", "Ballast", "Lanyard", "Mainsail", "Jib", "Spinnaker", "Lodestar", "Sextant",
  "Parrel", "Dinghy", "Hawser", "Scupper", "Gybe", "Tacking", "Bilge", "Lazarette",
  // Minerals
  "Basalt", "Quartz", "Feldspar", "Garnet", "Obsidian", "Jasper", "Shale", "Gneiss", "Pumice", "Tourmaline",
  "Cinnabar", "Malachite", "Sardonyx", "Beryl", "Chalcedony", "Olivine", "Pyrite", "Hematite", "Graphite", "Corundum",
  "Selenite", "Azurite", "Carnelian", "Mica", "Topaz", "Tenorite", "Scheelite",
  // Weather
  "Squall", "Monsoon", "Sirocco", "Mistral", "Zephyr", "Chinook", "Harmattan", "Bora", "Foehn", "Graupel",
  "Rime", "Hail", "Drizzle", "Cirrus", "Stratus", "Nimbus", "Gale", "Sleet", "Fogbank", "Cyclone",
  "Hoarfrost", "Thermal", "Doldrum", "Cumulus", "Tempest",
];

export const INDUSTRY_TEAM_FUNCTIONS: Record<Industry, string[]> = {
  Food: [
    "Vat Culture Operations", "Tower Harvest Scheduling", "Nutrient Formulation", "Cold-Chain Assurance", "Yield Forecasting",
    "Flavor Systems", "Food Safety Audit", "Protein Substrate R&D", "Retail Contracts", "Agritech Integration",
    "Batch Traceability", "Farm Sensor Maintenance", "Ration Procurement", "Packaging Compliance",
  ],
  Pharma: [
    "Clinical Trials", "Synthesis QA", "Regulatory Submissions", "Compound Discovery", "Pharmacovigilance",
    "Bioassay Lab", "Formulation Engineering", "Trial Site Relations", "Biologics Manufacturing", "Adverse Event Triage",
    "Batch Release", "Patent Strategy", "Cold Storage Logistics", "Medical Affairs", "Dosage Modeling",
  ],
  Security: [
    "Perimeter Operations", "Threat Intelligence", "Guard Rostering", "Incident Response", "Executive Protection",
    "Drone Patrol Command", "Access Control Systems", "Background Vetting", "Counter-Intrusion", "Facility Hardening",
    "Evidence Custody", "Insider Risk", "Contract Compliance", "Field Training",
  ],
  Cyberware: [
    "Implant Firmware", "Neural Interface Calibration", "Prosthetic Fitting", "Biocompatibility Testing", "Warranty and Recall",
    "Sensor Array Design", "Tissue Integration Lab", "Ocular Optics", "Field Service Dispatch", "Firmware Signing",
    "Surgical Partnerships", "Hardware Teardown", "Patient Consent Review", "Spare Parts Supply",
  ],
  Media: [
    "Newsroom Desk", "Feed Curation", "Ad Yield", "Creator Partnerships", "Broadcast Standards",
    "Archive Licensing", "Audience Analytics", "Immersive Content", "Rights Clearance", "Live Events",
    "Subtitle Production", "Editorial Review", "Sponsorship Sales", "Brand Safety",
  ],
  Logistics: [
    "Port Scheduling", "Fleet Maintenance", "Customs Brokerage", "Route Optimization", "Warehouse Automation",
    "Cargo Claims", "Drone Courier Dispatch", "Freight Forwarding", "Cold Chain Desk", "Driver Relations",
    "Demand Planning", "Container Yard Operations", "Returns Processing", "Last-Mile Routing",
  ],
  Finance: [
    "Treasury Desk", "Credit Underwriting", "Zuzu Settlement", "Wealth Advisory", "Risk Modeling",
    "Internal Audit", "Trade Finance", "Insurance Actuarial", "Collections", "Investor Relations",
    "Compliance Monitoring", "Fund Accounting", "Mergers Desk", "Retail Lending",
  ],
  Construction: [
    "Site Engineering", "Tower Framing", "Estimating", "Permit Liaison", "Subcontractor Management",
    "Materials Procurement", "Structural Inspection", "Crane Operations", "Concrete Mixing", "Safety Compliance",
    "Project Scheduling", "Urban Planning Liaison", "Demolition Planning", "Modular Fabrication",
  ],
  "Grid Services": [
    "Node Maintenance", "Mesh Dispatch", "AR Layer Authoring", "Local Service Desk", "Power Balancing",
    "Grid Resilience", "Substation Operations", "Latency Engineering", "Municipal Contracts", "Outage Response",
    "Sensor Calibration", "Network Peering", "Storm Hardening", "Capacity Planning",
  ],
  Manastelliate: [
    "Crystal Mining", "Lattice Refining", "Resonance Cutting", "Potency Certification", "Mage Client Relations",
    "Ritual Cut Design", "Mineral Rights", "Containment Safety", "Quality Assay", "Import Licensing",
    "Gemcraft Workshop", "Storage Vaults", "Surveying", "Attunement Testing",
  ],
};

export const INDUSTRY_SUBDIVISION_NAMES: Record<Industry, string[]> = {
  Food: ["Vat Division", "Tower Farms", "Consumer Brands", "Institutional Supply", "Agritech", "Flavor Labs", "Export Desk"],
  Pharma: ["Clinical Development", "Manufacturing", "Discovery Research", "Regulatory Affairs", "Commercial Distribution", "Medical Affairs", "Biologics"],
  Security: ["Static Guard", "Mobile Response", "Cyber Defense", "Private Intelligence", "Event Security", "Asset Protection", "Corporate Protective Services"],
  Cyberware: ["Implant Division", "Prosthetics", "Neural Interface", "Ocular and Sensory", "Clinical Services", "Field Service", "Research Annex"],
  Media: ["Newsroom", "Entertainment", "Social Feeds", "Advertising", "Archive", "Live Production", "Immersive Studios"],
  Logistics: ["Freight Operations", "Last Mile", "Cold Chain", "Port and Customs", "Warehousing", "Drone Courier", "Fleet Services"],
  Finance: ["Retail Banking", "Corporate Lending", "Asset Management", "Insurance", "Settlement and Clearing", "Private Wealth", "Treasury"],
  Construction: ["Civil Works", "Vertical Construction", "Modular Housing", "Infrastructure", "Materials", "Restoration", "Urban Renewal"],
  "Grid Services": ["Node Operations", "Local Service Networks", "AR Layer Services", "Municipal Grid", "Substation Engineering", "Resilience and Recovery", "Mesh Dispatch"],
  Manastelliate: ["Mining", "Refining", "Cutting and Setting", "Certification", "Client Services", "Containment", "Vault Storage"],
};

export const DIVISION_SUFFIXES: Record<Industry, string[]> = {
  Food: ["Nutrition", "Agritech", "Foods", "Harvest", "Provisions"],
  Pharma: ["Therapeutics", "Biosciences", "Pharma", "Life Sciences", "Labs"],
  Security: ["Protective", "Security", "Guard", "Defense", "Sentinel"],
  Cyberware: ["Cybernetics", "Biomech", "Neural", "Implants", "Systems"],
  Media: ["Media", "Broadcast", "Networks", "Press", "Studios"],
  Logistics: ["Logistics", "Freight", "Transit", "Carriers", "Lines"],
  Finance: ["Capital", "Financial", "Trust", "Holdings", "Securities"],
  Construction: ["Construction", "Builders", "Civil", "Structures", "Works"],
  "Grid Services": ["Grid", "Power", "Mesh", "Relay", "Utilities"],
  Manastelliate: ["Crystal", "Lattice", "Resonance", "Gemworks", "Arcana"],
};

export const COMPANY_NAME_SUGGESTIONS: string[] = [
  "Hoshida Combine", "Varrick-Lund", "Aurelian Holdings", "Tachibana Zaibatsu", "Mirovane Industrial",
  "Kessler-Oyelaran", "Sendai Concern", "Ostrander Group", "Nakashima Dynamics", "Obsidian Meridian",
  "Corvane Systems", "Halvorsen Consolidated", "Ishikawa Mercantile", "Veyra Holdings", "Tanaka-Brandt",
  "Solenne Industries", "Kuroiwa Heavy Works", "Dalgaard Concern", "Okuyama Pacific", "Castellan Holdings",
  "Yorimitsu Combine", "Rasmussen-Achterberg", "Thessaly Group", "Pemberton-Asai",
  "Chandrasekar Syndicate", "Aldous Crane Holdings", "Kagetsu Keiretsu", "Lindqvist Veldt", "Quorin Tessel",
  "Benedek Continental", "Hartwell-Sato", "Orison Industries", "Vantara Combine", "Shimaoka Works",
  "Ardent Lattice Co.", "Soren-Akhtar Group", "Nuevo Caldera Holdings", "Tiberine Mercantile", "Lindgren-Okeke Concern",
];

export const CLIQUE_NAMES: string[] = [
  "The Old Guard", "The Tower Nine Lunch Club", "The Reformers", "The Quiet Floor", "The Night Shift Circle",
  "The Graduates", "The Lakeside Set", "The Cost Center", "The Ops Table", "The Founders' Remnant",
  "The Sixth Floor Bloc", "The Pension Trust", "The Long Lunch Group", "The Auditors", "The Cyberware Caucus",
  "The Greenhouse Set", "The Unfiled Reports", "The Second Tower", "The Monday Kitchen", "The Gardeners",
  "The Ledger Club", "The Sunday Dinner Circle", "The Hallway Table", "The Compliance Quorum", "The Rooftop Smokers",
  "The Pragmatists", "The Fourth Generation", "The Transfer Students", "The Dockside Crowd", "The Engineering Parish",
  "The Quiet Money", "The Chapel Committee", "The Retirement Club", "The Vendor Dinner Set", "The Parking Garage Crowd",
];

export const CLIQUE_AGENDAS: string[] = [
  "Push the old guard out of the division head seats.",
  "Get the tower-grown food contract moved to an outside vendor before the audit.",
  "Force an independent review of the Grid Services maintenance budget.",
  "Protect the pension fund from the next restructuring round.",
  "Win a seat on the promotions board for anyone who came up from the plants.",
  "Stop the cyberware warranty program from being quietly cut.",
  "Make the zuzu settlement desk answer to the finance committee, not the chairman's office.",
  "Trade favors with the security chiefs to keep the night shift staffed.",
  "Ship the Manastelliate certification backlog out the door, whatever the paperwork says.",
  "Bring the uplift handlers into the main reporting chain.",
  "Quietly bury the Q3 incident report until after the board vote.",
  "Replace the lunch-hour deal-making with a monthly open forum.",
  "Keep the drone fleet budget out of the subsidiary spin-off.",
  "Move the synthetic workforce onto the same contracts as human staff.",
  "Get a rival division's head moved sideways to a dead-end post.",
  "Pass the new vendor screening rules before the next procurement cycle.",
  "Push for the media subsidiary to be sold before it drags down the group rating.",
  "Use the upcoming merger to take control of the logistics routing contracts.",
  "Block the reformers' audit of executive travel expenses.",
  "Secure a deal with the municipal grid authority that keeps the division's name on the nodes.",
  "Recruit one more senior engineer from the Cyberware side before the reorganization.",
  "Kill the mandatory retraining program for middle managers.",
];
