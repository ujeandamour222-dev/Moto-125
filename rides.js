import { DataStore } from "./firebase.js";
import { renderRiderCards, renderTripCards, escapeHtml, formatRWF } from "./render.js";

/* =========================================================
   FARE CONFIG — igiciro cy'urugendo, gitandukanye hagati
   ya Moto na Imodoka (Dereva), bishingiye ku biciro by'ukuri
   byo mu Rwanda muri 2026:
   - Moto (boda-boda): 500–1,500 RWF mu mujyi, bishingiye ku
     ntera (Yego Moto).
   - Imodoka (cab/dereva): igiciro cy'ibanze ~3,000 RWF +
     ~1,000 RWF kuri buri km (nka Yego Cab / GoByTaxi).
   Aya ni amanota y'itangiriro (default) — Owner ashobora
   kuyahindura ubwe muri 👑 Owner Dashboard (nta code ikenewe);
   igihe byabitswe, bibikwa muri "settings/fareConfig" kandi
   bikoreshwa ako kanya n'abakoresha bose.
   ========================================================= */
const DEFAULT_FARE_TIERS = {
  moto: { label: "Moto", baseFare: 500, perKm: 500, minFare: 500, roundTo: 100 },
  car: { label: "Imodoka", baseFare: 3000, perKm: 1000, minFare: 3000, roundTo: 100 }
};

const FARE_TIERS = JSON.parse(JSON.stringify(DEFAULT_FARE_TIERS));

let fareTiersLoadPromise = null;
function ensureFareTiersLoaded() {
  if (!fareTiersLoadPromise) {
    fareTiersLoadPromise = DataStore.getDoc("settings", "fareConfig")
      .then(doc => {
        if (doc?.moto) Object.assign(FARE_TIERS.moto, doc.moto);
        if (doc?.car) Object.assign(FARE_TIERS.car, doc.car);
      })
      .catch(() => {});
  }
  return fareTiersLoadPromise;
}
ensureFareTiersLoaded();

export async function getFareTiers() {
  await ensureFareTiersLoaded();
  return FARE_TIERS;
}

export async function saveFareTiers(newTiers) {
  if (newTiers.moto) Object.assign(FARE_TIERS.moto, newTiers.moto);
  if (newTiers.car) Object.assign(FARE_TIERS.car, newTiers.car);
  await DataStore.setDoc("settings", "fareConfig", {
    moto: { baseFare: FARE_TIERS.moto.baseFare, perKm: FARE_TIERS.moto.perKm, minFare: FARE_TIERS.moto.minFare },
    car: { baseFare: FARE_TIERS.car.baseFare, perKm: FARE_TIERS.car.perKm, minFare: FARE_TIERS.car.minFare }
  });
}

let currentVehicleFilter = "all";

function toRad(v) { return (v * Math.PI) / 180; }

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function renderRiders() {
  const riders = await DataStore.list("riders");
  window.App.data.riders = riders;
  applyRiderFilterAndRender();
}

function applyRiderFilterAndRender() {
  let riders = window.App.data.riders || [];
  if (currentVehicleFilter !== "all") {
    riders = riders.filter(r => (r.vehicleType || "moto") === currentVehicleFilter);
  }
  renderRiderCards(sortByDistanceIfKnown(riders));
  updateFilterButtons();
}

function updateFilterButtons() {
  const map = { all: "filterAllBtn", moto: "filterMotoBtn", car: "filterCarBtn" };
  Object.entries(map).forEach(([type, id]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (type === currentVehicleFilter) {
      btn.classList.remove("secondary");
      btn.classList.add("primary");
    } else {
      btn.classList.remove("primary");
      btn.classList.add("secondary");
    }
  });
}

window.filterRidersByType = function (type) {
  currentVehicleFilter = type;
  applyRiderFilterAndRender();
};

function sortByDistanceIfKnown(riders) {
  const pos = window.App.lastKnownPosition;
  if (!pos) return riders;
  return riders
    .map(r => ({
      ...r,
      distanceKm: (typeof r.lat === "number" && typeof r.lng === "number")
        ? distanceKm(pos.lat, pos.lng, r.lat, r.lng)
        : undefined
    }))
    .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
}

window.findNearbyRiders = async function () {
  const statusEl = document.getElementById("riderStatus");

  if (!navigator.geolocation) {
    statusEl.innerHTML = `<div class="notice error">Iyi terefone ntishoboye kubona aho uri.</div>`;
    await renderRiders();
    return;
  }

  statusEl.innerHTML = `<div class="notice">📍 Turimo dushakisha aho uri...</div>`;

  navigator.geolocation.getCurrentPosition(
    async pos => {
      window.App.lastKnownPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      await renderRiders();
      statusEl.innerHTML = `<div class="notice success">✅ Ababonetse bakwegereye batondekanijwe uhereye ku wari hafi.</div>`;
    },
    async () => {
      statusEl.innerHTML = `<div class="notice error">Ntibyashobotse kubona aho uri. Reba uruhushya rwa GPS.</div>`;
      await renderRiders();
    }
  );
};

/* =========================================================
   KUBARA IGICIRO CY'URUGENDO (fare estimate)
   =========================================================
   Dukoresha OpenStreetMap (Nominatim) kubona aho ujya, hanyuma
   OSRM kubara intera nyayo (km) hagati y'aho uri n'aho ujya.
   Igiciro gishingiye ku bwoko bw'ikinyabiziga (moto/car).
   ========================================================= */

async function estimateFare(destinationText, vehicleType) {
  const pos = window.App.lastKnownPosition;
  if (!pos) throw new Error("no-location");

  await ensureFareTiersLoaded();
  const tier = FARE_TIERS[vehicleType] || FARE_TIERS.moto;

  const geoRes = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(destinationText)}, Rwanda`
  );
  const geoData = await geoRes.json();
  if (!geoData || geoData.length === 0) throw new Error("no-destination");

  const destLat = Number(geoData[0].lat);
  const destLng = Number(geoData[0].lon);

  const routeRes = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${pos.lng},${pos.lat};${destLng},${destLat}?overview=false`
  );
  const routeData = await routeRes.json();
  if (!routeData.routes || routeData.routes.length === 0) throw new Error("no-route");

  const km = routeData.routes[0].distance / 1000;
  const minutes = Math.round(routeData.routes[0].duration / 60);
  const rawFare = tier.baseFare + tier.perKm * km;
  const fare = Math.max(tier.minFare, Math.round(rawFare / tier.roundTo) * tier.roundTo);

  return { destLat, destLng, distanceKm: km, minutes, fare, vehicleType, tierLabel: tier.label };
}

/* =========================================================
   GUSABA URUGENDO (request a ride, with fare confirmation)
   ========================================================= */

window.requestRide = function (riderId) {
  window.requireLogin(() => openRideRequestModal(riderId));
};

function openRideRequestModal(riderId) {
  const rider = (window.App.data.riders || []).find(r => r.id === riderId);
  const vehicleType = rider?.vehicleType === "car" ? "car" : "moto";
  const tier = FARE_TIERS[vehicleType];
  const modal = document.getElementById("modal");
  const content = document.getElementById("modalContent");

  content.innerHTML = `
    <h2>${vehicleType === "car" ? "🚗" : "🏍️"} Saba ${escapeHtml(rider?.fullName || "umukoresha")}</h2>
    <p><small>Ubwoko: ${escapeHtml(tier.label)}</small></p>
    <label>Aho ujya</label>
    <input id="rideDestination" placeholder="Urugero: Kigali City Market">
    <button class="primary" id="estimateFareBtn">💰 Menya igiciro</button>
    <div id="fareResult"></div>
  `;

  modal.classList.remove("hidden");

  document.getElementById("estimateFareBtn").onclick = async () => {
    const destInput = document.getElementById("rideDestination");
    const fareResult = document.getElementById("fareResult");
    const destination = destInput.value.trim();

    if (!destination) {
      fareResult.innerHTML = `<div class="notice error">Andika aho ujya.</div>`;
      return;
    }
    if (!window.App.lastKnownPosition) {
      fareResult.innerHTML = `<div class="notice error">Banza umenye aho uri (📍 Menya aho ndi) mbere yo gusaba urugendo.</div>`;
      return;
    }

    fareResult.innerHTML = `<div class="notice">⏳ Turimo kubara igiciro...</div>`;

    try {
      const est = await estimateFare(destination, vehicleType);
      fareResult.innerHTML = `
        <div class="notice success">
          🛣️ ${est.distanceKm.toFixed(1)} km — hafi iminota ${est.minutes}<br>
          <span class="price">${formatRWF(est.fare)}</span>
        </div>
        <button class="primary" id="confirmRideBtn">✅ Emeza urugendo</button>
      `;
      document.getElementById("confirmRideBtn").onclick = async () => {
        await createRideRequest(rider, destination, est);
        window.closeModal();
      };
    } catch (error) {
      console.error(error);
      fareResult.innerHTML = `<div class="notice error">Ntibyashobotse kubara igiciro. Reba ko wanditse aho ujya neza (urugero wongereho akarere), ongera ugerageze.</div>`;
    }
  };
}

async function createRideRequest(rider, destination, est) {
  await DataStore.add("trips", {
    passengerUid: window.App.currentUser.uid,
    riderId: rider?.id || null,
    riderName: rider?.fullName || "",
    vehicleType: est.vehicleType,
    from: "Aho uri ubu",
    to: destination,
    distanceKm: Number(est.distanceKm.toFixed(1)),
    fare: est.fare,
    status: "pending"
  });

  await DataStore.add("notifications", {
    uid: window.App.currentUser.uid,
    title: "Icyifuzo cyoherejwe",
    body: `Wasabye ${rider?.fullName || "umukoresha"} (${est.tierLabel}) kuguha urugendo kugera kuri ${destination}. Igiciro: ${formatRWF(est.fare)}.`,
    read: false
  });

  alert(`✅ Icyifuzo cyoherejwe. Igiciro cy'urugendo: ${formatRWF(est.fare)}`);
}

window.quickRide = function () {
  window.requireLogin(async () => {
    window.openPage("riders");
    await window.findNearbyRiders();
  });
};

export async function renderTrips() {
  if (!window.App.currentUser) {
    renderTripCards([]);
    return;
  }
  const trips = await DataStore.list("trips", {
    where: ["passengerUid", "==", window.App.currentUser.uid]
  });
  window.App.data.trips = trips;
  renderTripCards(trips);
}

window.renderRiders = renderRiders;
window.renderTrips = renderTrips;
