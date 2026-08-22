import { DataStore } from "./firebase.js";
import { nameWithBadge, escapeHtml, emptyState, formatRWF } from "./render.js";
import { getFareTiers, saveFareTiers } from "./rides.js";

/* =========================================================
   👑 OWNER DASHBOARD
   =========================================================
   Ahantu admin/owner abona incamake y'ibyabaye byose (stats),
   hanyuma agakemeza (verify) umuntu cyangwa ikintu — akamenyetso
   ✅ Yemejwe kagahita kagaragara ahantu hose iryo zina cyangwa
   icyo gicuruzwa bigaragara. Iyi paji igaragara/ikorwa gusa ku
   bafite isAdmin === true.
   ========================================================= */

const VERIFY_SECTIONS = [
  { key: "riders", vehicleType: "moto", label: "🏍️ Abamotari (Moto)", nameField: "fullName" },
  { key: "riders", vehicleType: "car", label: "🚗 Abadereva (Imodoka)", nameField: "fullName" },
  { key: "businesses", label: "🏪 Ubucuruzi", nameField: "name" },
  { key: "listings", label: "🛒 Ibicuruzwa", nameField: "title" },
  { key: "motorcycles", label: "🏍️ Amamoto agurishwa", nameField: "title" }
];

export async function renderAdmin() {
  const container = document.getElementById("adminContent");
  if (!container) return;

  if (!window.App.currentUser || !window.App.currentUser.isAdmin) {
    container.innerHTML = `
      <div class="notice error">
        Iyi paji ni iy'abakoresha admin/owner gusa.
      </div>`;
    return;
  }

  container.innerHTML = `<div class="notice">⏳ Turimo gutegura dashboard...</div>`;

  const [users, riders, trips, payments, listings, motorcycles, businesses] = await Promise.all([
    DataStore.list("users"),
    DataStore.list("riders"),
    DataStore.list("trips"),
    DataStore.list("payments"),
    DataStore.list("listings"),
    DataStore.list("motorcycles"),
    DataStore.list("businesses")
  ]);

  const motoRiders = riders.filter(r => (r.vehicleType || "moto") === "moto");
  const carRiders = riders.filter(r => r.vehicleType === "car");
  const motoTripFares = trips.filter(t => (t.vehicleType || "moto") === "moto").reduce((s, t) => s + (Number(t.fare) || 0), 0);
  const carTripFares = trips.filter(t => t.vehicleType === "car").reduce((s, t) => s + (Number(t.fare) || 0), 0);

  const totalPaid = payments.filter(p => p.status === "confirmed").reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const pendingPayments = payments.filter(p => p.status === "pending_confirmation");
  const pendingTrips = trips.filter(t => t.status === "pending").length;
  const unverifiedCount =
    riders.filter(r => !r.isVerified).length +
    businesses.filter(b => !b.isVerified).length +
    listings.filter(l => !l.isVerified).length +
    motorcycles.filter(m => !m.isVerified).length;

  const userMap = {};
  users.forEach(u => { userMap[u.uid || u.id] = u; });

  container.innerHTML = `
    <div class="grid" style="margin-bottom:6px">
      ${statCard("👥", "Abakoresha", users.length)}
      ${statCard("🏍️", "Abamotari", motoRiders.length)}
      ${statCard("🚗", "Abadereva", carRiders.length)}
      ${statCard("🛣️", "Ingendo (birategerejwe)", pendingTrips + " / " + trips.length)}
      ${statCard("🏍️💰", "Igiciro cy'ingendo za Moto", formatRWF(motoTripFares))}
      ${statCard("🚗💰", "Igiciro cy'ingendo z'Imodoka", formatRWF(carTripFares))}
      ${statCard("💰", "Ubwishyu bwemejwe", formatRWF(totalPaid))}
      ${statCard("⏳", "Bitaremezwa (✅)", unverifiedCount)}
    </div>
  `;

  container.innerHTML += await renderFareSettingsCard();
  container.innerHTML += renderPaymentsQueue(pendingPayments, userMap);

  const grouped = { riders_moto: motoRiders, riders_car: carRiders, businesses, listings, motorcycles };

  const sections = VERIFY_SECTIONS.map(s => ({
    ...s,
    items: s.vehicleType ? grouped[`${s.key}_${s.vehicleType}`] : grouped[s.key]
  }));

  container.innerHTML += sections.map(s => `
    <div class="card">
      <h3>${s.label}</h3>
      ${s.items.length === 0 ? emptyState("Nta bimazemo.") : s.items.map(item => `
        <div class="list">
          <div class="list-row">
            ${nameWithBadge(item[s.nameField] || "—", item)}
            <div style="display:flex;gap:6px">
              <button class="secondary" style="width:auto" onclick="window.toggleVerify('${s.key}','${item.id}',${!item.isVerified})">
                ${item.isVerified ? "Kuraho ✅" : "Emeza ✅"}
              </button>
            </div>
          </div>
        </div>
      `).join("")}
    </div>
  `).join("");
}

/* =========================================================
   UBWISHYU BUTEGEREJE KWEMEZWA (MTN MoMo)
   =========================================================
   Kuko kwishyura bikorwa hanze ya app (dial ya MoMo ku
   terefone y'umukoresha), Owner niwe ugenzura reference
   umukoresha yatanze, akemeza ubwo bwishyu hano.
   ========================================================= */

function renderPaymentsQueue(pendingPayments, userMap) {
  return `
    <div class="card">
      <h3>💰 Ubwishyu bwategereje kwemezwa (${pendingPayments.length})</h3>
      ${pendingPayments.length === 0 ? emptyState("Nta bwishyu butegereje kwemezwa.") : pendingPayments.map(p => `
        <div class="list">
          <div class="list-row">
            <div>
              <b>${formatRWF(p.amount)}</b> — ${escapeHtml(p.purpose || "")}
              <div><small>${escapeHtml(userMap[p.uid]?.fullName || userMap[p.uid]?.email || p.uid || "—")}</small></div>
              <div><small>Ref: ${p.reference ? escapeHtml(p.reference) : "— (nta reference yatanzwe; genzura ku ruhande rwa MoMo)"}</small></div>
            </div>
            <button class="secondary" style="width:auto" onclick="window.confirmPayment('${p.id}', ${p.tripId ? `'${p.tripId}'` : "null"})">✅ Emeza</button>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

window.confirmPayment = async function (paymentId, tripId) {
  await DataStore.setDoc("payments", paymentId, { status: "confirmed" });
  if (tripId) {
    await DataStore.setDoc("trips", tripId, { paid: true });
  }
  await renderAdmin();
};

function statCard(icon, label, value) {
  return `
    <div class="service" style="min-height:auto;padding:16px 10px">
      <span class="ico" style="font-size:26px">${icon}</span>
      <b style="font-size:19px">${escapeHtml(String(value))}</b>
      <small>${escapeHtml(label)}</small>
    </div>
  `;
}

/* =========================================================
   IBICIRO CY'INGENDO — Owner ahindura ibiciro yishyize
   nta code ikenewe. Bibikwa muri settings/fareConfig,
   bigakoreshwa ako kanya n'abakoresha bose (rides.js).
   ========================================================= */

async function renderFareSettingsCard() {
  const tiers = await getFareTiers();

  return `
    <div class="card">
      <h3>⚙️ Ibiciro by'ingendo</h3>

      <p><b>🏍️ Moto</b></p>
      <label>Igiciro cy'ibanze (RWF)</label>
      <input id="fareMotoBase" type="number" min="0" value="${tiers.moto.baseFare}">
      <label>Igiciro kuri buri km (RWF)</label>
      <input id="fareMotoPerKm" type="number" min="0" value="${tiers.moto.perKm}">
      <label>Igiciro gito kurusha byose (RWF)</label>
      <input id="fareMotoMin" type="number" min="0" value="${tiers.moto.minFare}">

      <p style="margin-top:14px"><b>🚗 Imodoka</b></p>
      <label>Igiciro cy'ibanze (RWF)</label>
      <input id="fareCarBase" type="number" min="0" value="${tiers.car.baseFare}">
      <label>Igiciro kuri buri km (RWF)</label>
      <input id="fareCarPerKm" type="number" min="0" value="${tiers.car.perKm}">
      <label>Igiciro gito kurusha byose (RWF)</label>
      <input id="fareCarMin" type="number" min="0" value="${tiers.car.minFare}">

      <button class="primary" onclick="window.saveFareSettings()">💾 Bika ibiciro</button>
      <div id="fareSettingsStatus"></div>
    </div>
  `;
}

window.saveFareSettings = async function () {
  const statusEl = document.getElementById("fareSettingsStatus");
  statusEl.innerHTML = `<div class="notice">⏳ Turimo kubika...</div>`;

  try {
    const newTiers = {
      moto: {
        baseFare: Number(document.getElementById("fareMotoBase").value) || 0,
        perKm: Number(document.getElementById("fareMotoPerKm").value) || 0,
        minFare: Number(document.getElementById("fareMotoMin").value) || 0
      },
      car: {
        baseFare: Number(document.getElementById("fareCarBase").value) || 0,
        perKm: Number(document.getElementById("fareCarPerKm").value) || 0,
        minFare: Number(document.getElementById("fareCarMin").value) || 0
      }
    };
    await saveFareTiers(newTiers);
    statusEl.innerHTML = `<div class="notice success">✅ Ibiciro byabitswe. Abakoresha bazahita babibona ku ngendo zishya.</div>`;
  } catch (error) {
    console.error(error);
    statusEl.innerHTML = `<div class="notice error">Habaye ikibazo. Ongera ugerageze.</div>`;
  }
};

window.toggleVerify = async function (collectionName, id, nextValue) {
  await DataStore.setDoc(collectionName, id, { isVerified: nextValue });
  await renderAdmin();

  /* Keep every already-rendered list in sync with the new badge state */
  if (collectionName === "riders" && typeof window.renderRiders === "function") window.renderRiders();
  if (collectionName === "businesses" && typeof window.renderBusinesses === "function") window.renderBusinesses();
  if (collectionName === "listings" && typeof window.renderMarket === "function") window.renderMarket();
  if (collectionName === "motorcycles" && typeof window.renderMotorcycles === "function") window.renderMotorcycles();
};

window.renderAdmin = renderAdmin;
