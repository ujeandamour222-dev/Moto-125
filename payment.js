import { DataStore } from "./firebase.js";
import { PAYMENT_CONFIG } from "./firebase.js";
import { formatRWF } from "./render.js";

/* =========================================================
   KWISHYURA — MTN Mobile Money
   =========================================================
   1) Umukoresha yandika amafaranga n'impamvu
   2) Akanda "Ishyura kuri MoMo" — terefone ye ihita ifungura
      dial ya MoMo yuzuye (*182*8*1*momoCode*amount#), nta
      kwandika kode ubwe bikenewe
   3) Yemeza akoresheje PIN ye kuri terefone (hanze ya app —
      ibi ni ingenzi ya MTN, ntibishoboka kubinyuraho)
   4) Agaruka muri app, akinjiza reference/SMS yabonye
   5) Owner abibona muri 👑 Owner Dashboard, akabyemeza
   ========================================================= */

function buildMomoUssd(amount) {
  // *182*8*1*<code>*<amount>#  — dial format ya MTN MoMo
  // kwishyura ku Merchant/Till Code
  return `*182*8*1*${PAYMENT_CONFIG.momoCode}*${amount}%23`;
}

window.payForTrip = function (tripId, fare) {
  window.App.payingForTripId = tripId;
  window.openPage("payment");
  setTimeout(() => {
    const amountEl = document.getElementById("paymentAmount");
    const purposeEl = document.getElementById("paymentPurpose");
    if (amountEl) amountEl.value = fare;
    if (purposeEl) purposeEl.value = "ride";
  }, 50);
};

window.payWithMomo = function () {
  const amountEl = document.getElementById("paymentAmount");
  const statusEl = document.getElementById("paymentStatus");
  const amount = Number(amountEl.value);

  if (!amount || amount < 100) {
    statusEl.innerHTML = `<div class="notice error">Andika amafaranga nibura 100 RWF mbere yo gukanda "Ishyura kuri MoMo".</div>`;
    return;
  }
  if (!PAYMENT_CONFIG.momoCode) {
    statusEl.innerHTML = `<div class="notice error">Nta MoMo code yashyizweho. Reba na Owner.</div>`;
    return;
  }

  statusEl.innerHTML = `<div class="notice">📲 Terefone yawe irimo gufungura dial ya MoMo... Emeza ukoresheje PIN yawe, hanyuma ugaruke wandike reference hepfo.</div>`;

  // Ifungura dial ya terefone yuzuyemo — umukoresha ntagomba
  // kwandika kode ubwe.
  window.location.href = "tel:" + buildMomoUssd(amount);
};

window.submitPayment = async function () {
  window.requireLogin(async () => {
    const amountEl = document.getElementById("paymentAmount");
    const purposeEl = document.getElementById("paymentPurpose");
    const referenceEl = document.getElementById("paymentReference");
    const statusEl = document.getElementById("paymentStatus");

    const amount = Number(amountEl.value);
    const purpose = purposeEl.value;
    const reference = referenceEl.value.trim();

    if (!amount || amount < 100) {
      statusEl.innerHTML = `<div class="notice error">Andika amafaranga nibura 100 RWF.</div>`;
      return;
    }
    // Reference si ngombwa — niba atarayibona (SMS itaragera, cyangwa
    // yizeye kuyigaruka nyuma), icyifuzo kibikwa nk'uko kimeze, Owner
    // akazabyemeza amaze kubona ubwishyu ku ruhande rwe rwa MoMo.

    statusEl.innerHTML = `<div class="notice">⏳ Turimo kubika icyifuzo cyawe cy'ubwishyu...</div>`;

    try {
      const useApi = PAYMENT_CONFIG.endpoint && PAYMENT_CONFIG.endpoint.trim() !== "";

      if (useApi) {
        /* Niba hari backend ya Request-to-Pay API, iyi niyo yakwitwa
           hano. Ntabwo hano hashyirwaho secret keys cyangwa server
           tokens — izo ziba ziri kuri backend gusa. */
        const res = await fetch(PAYMENT_CONFIG.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount,
            purpose,
            reference,
            uid: window.App.currentUser.uid
          })
        });
        if (!res.ok) throw new Error("Payment API error");
      }

      await DataStore.add("payments", {
        uid: window.App.currentUser.uid,
        amount,
        purpose,
        reference,
        tripId: window.App.payingForTripId || null,
        status: "pending_confirmation" // Owner niwe uzabyemeza muri Dashboard
      });
      window.App.payingForTripId = null;

      await DataStore.add("notifications", {
        uid: window.App.currentUser.uid,
        title: "Ubwishyu bwoherejwe",
        body: `Icyifuzo cyawe cyo kwishyura ${formatRWF(amount)} cyoherejwe, gitegereje kwemezwa.`,
        read: false
      });

      statusEl.innerHTML = `<div class="notice success">✅ Twabonye icyifuzo cyawe (${formatRWF(amount)}). Kitegereje kwemezwa.</div>`;
      amountEl.value = "";
      referenceEl.value = "";
    } catch (error) {
      console.error(error);
      statusEl.innerHTML = `<div class="notice error">Habaye ikibazo mu kohereza ubwishyu. Ongera ugerageze.</div>`;
    }
  });
};
