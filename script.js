import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

const LOCAL_STORAGE_KEY = "cute-wishlist-local-fallback-v1";
const FIXED_ROOM_CODE = "be-yeu";

const firebaseConfig = {
  apiKey: "AIzaSyCDcm7Z9nD4CkYtlZOYmmlmkmEId7XX6qg",
  authDomain: "wishlist-68b48.firebaseapp.com",
  projectId: "wishlist-68b48",
  storageBucket: "wishlist-68b48.firebasestorage.app",
  messagingSenderId: "386886645380",
  appId: "1:386886645380:web:51c55efa9cd7bd2aa5b4d1",
  measurementId: "G-91FN4Q5W3Z"
};

const wishForm = document.getElementById("wishForm");
const wishListEl = document.getElementById("wishList");
const wishCountEl = document.getElementById("wishCount");
const filterEl = document.getElementById("filter");
const pickBtn = document.getElementById("pickBtn");
const pickedResultEl = document.getElementById("pickedResult");
const clearGiftedBtn = document.getElementById("clearGiftedBtn");
const template = document.getElementById("wishItemTemplate");

const priorityLabelMap = {
  high: "Rất thích",
  medium: "Thích",
  low: "Có cũng được"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let wishes = [];
const currentRoom = FIXED_ROOM_CODE;
let unsubscribeRealtime = null;
let fallbackMode = false;

subscribeRoom(currentRoom);
render();

wishForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(wishForm);
  const name = (formData.get("name") || "").toString().trim();
  const link = (formData.get("link") || "").toString().trim();
  const note = (formData.get("note") || "").toString().trim();
  const priceRaw = (formData.get("price") || "").toString().trim();
  const priority = (formData.get("priority") || "medium").toString();

  if (!name) {
    return;
  }

  if (link && !isValidUrl(link)) {
    alert("Link chưa hợp lệ. Hãy nhập đúng định dạng https://...");
    return;
  }

  const parsedPrice = priceRaw ? Number(priceRaw) : null;
  const newWish = {
    id: crypto.randomUUID(),
    name,
    link,
    note,
    price: Number.isFinite(parsedPrice) ? Math.max(0, parsedPrice) : null,
    priority: priority in priorityLabelMap ? priority : "medium",
    picked: false,
    gifted: false,
    createdAt: Date.now()
  };

  await persistNewWish(newWish);
  wishForm.reset();
  pickedResultEl.textContent = "";
});

filterEl.addEventListener("change", () => {
  render();
});

pickBtn.addEventListener("click", async () => {
  const candidates = wishes.filter((wish) => !wish.gifted);

  if (candidates.length === 0) {
    pickedResultEl.textContent = "Không còn món nào để chọn, em đã được tặng hết rồi.";
    return;
  }

  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  await updateWish(selected.id, { picked: true });
  pickedResultEl.textContent = `Hôm nay gợi ý: ${selected.name}`;
});

clearGiftedBtn.addEventListener("click", async () => {
  const gifted = wishes.filter((wish) => wish.gifted);
  if (gifted.length === 0) {
    return;
  }

  if (fallbackMode) {
    wishes = wishes.filter((wish) => !wish.gifted);
    persistLocalFallback();
    render();
    pickedResultEl.textContent = "Đã xóa các mục đã tặng.";
    return;
  }

  const batch = writeBatch(db);
  for (const wish of gifted) {
    batch.delete(doc(db, "rooms", currentRoom, "wishes", wish.id));
  }
  await batch.commit();
  pickedResultEl.textContent = "Đã xóa các mục đã tặng.";
});

wishListEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const actionButton = target.closest("button[data-action]");
  if (!actionButton) {
    return;
  }

  const action = actionButton.getAttribute("data-action");
  const itemEl = actionButton.closest(".wish-item");
  const id = itemEl?.getAttribute("data-id");

  if (!id || !action) {
    return;
  }

  const wish = wishes.find((entry) => entry.id === id);
  if (!wish) {
    return;
  }

  if (action === "delete") {
    await removeWish(id);
    return;
  }

  if (action === "toggle-picked") {
    await updateWish(id, { picked: !wish.picked });
    return;
  }

  if (action === "toggle-gifted") {
    await updateWish(id, {
      gifted: !wish.gifted,
      picked: wish.gifted ? wish.picked : true
    });
  }
});

async function persistNewWish(newWish) {
  if (fallbackMode) {
    wishes.unshift(newWish);
    persistLocalFallback();
    render();
    return;
  }

  await setDoc(doc(db, "rooms", currentRoom, "wishes", newWish.id), newWish);
}

async function updateWish(id, patch) {
  if (fallbackMode) {
    wishes = wishes.map((wish) => (wish.id === id ? { ...wish, ...patch } : wish));
    persistLocalFallback();
    render();
    return;
  }

  await updateDoc(doc(db, "rooms", currentRoom, "wishes", id), patch);
}

async function removeWish(id) {
  if (fallbackMode) {
    wishes = wishes.filter((wish) => wish.id !== id);
    persistLocalFallback();
    render();
    return;
  }

  await deleteDoc(doc(db, "rooms", currentRoom, "wishes", id));
}

function subscribeRoom(roomCode) {
  if (unsubscribeRealtime) {
    unsubscribeRealtime();
  }

  fallbackMode = false;

  const wishesQuery = query(
    collection(db, "rooms", roomCode, "wishes"),
    orderBy("createdAt", "desc")
  );

  unsubscribeRealtime = onSnapshot(
    wishesQuery,
    (snapshot) => {
      wishes = snapshot.docs.map((wishDoc) => ({
        id: wishDoc.id,
        ...wishDoc.data()
      }));
      render();
    },
    () => {
      fallbackMode = true;
      wishes = loadLocalFallback();
      render();
      pickedResultEl.textContent = "Đang ở chế độ local (chưa kết nối Firebase/Rules).";
    }
  );
}

function render() {
  const filtered = getFilteredWishes();

  wishListEl.innerHTML = "";

  if (filtered.length === 0) {
    const empty = document.createElement("li");
    empty.className = "wish-item";
    empty.textContent = "Chưa có món nào trong danh sách này.";
    wishListEl.append(empty);
  } else {
    for (const wish of filtered) {
      const fragment = template.content.cloneNode(true);
      const item = fragment.querySelector(".wish-item");
      const name = fragment.querySelector(".wish-name");
      const priority = fragment.querySelector(".wish-priority");
      const price = fragment.querySelector(".wish-price");
      const note = fragment.querySelector(".wish-note");
      const link = fragment.querySelector(".wish-link");
      const pickedBtn = fragment.querySelector('button[data-action="toggle-picked"]');
      const giftedBtn = fragment.querySelector('button[data-action="toggle-gifted"]');

      item.setAttribute("data-id", wish.id);
      name.textContent = wish.name || "(Không có tên món)";

      const safePriority = wish.priority || "medium";
      priority.textContent = priorityLabelMap[safePriority] || priorityLabelMap.medium;
      priority.classList.add(`priority-${safePriority}`);

      price.textContent = typeof wish.price === "number" ? formatCurrency(wish.price) : "Chưa có giá";

      if (wish.note) {
        note.textContent = wish.note;
      } else {
        note.remove();
      }

      if (wish.link) {
        link.href = wish.link;
      } else {
        link.remove();
      }

      if (wish.picked) {
        item.classList.add("is-picked");
      }

      if (wish.gifted) {
        item.classList.add("is-gifted");
      }

      pickedBtn.textContent = wish.picked ? "Bỏ chọn mua" : "Đánh dấu mua";
      giftedBtn.textContent = wish.gifted ? "Bỏ đã tặng" : "Đã tặng";

      wishListEl.append(fragment);
    }
  }

  wishCountEl.textContent = `${wishes.length} món`;
}

function getFilteredWishes() {
  const mode = filterEl.value;

  if (mode === "open") {
    return wishes.filter((wish) => !wish.gifted);
  }

  if (mode === "picked") {
    return wishes.filter((wish) => wish.picked && !wish.gifted);
  }

  if (mode === "gifted") {
    return wishes.filter((wish) => wish.gifted);
  }

  return wishes;
}

function isValidUrl(value) {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function loadLocalFallback() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((wish) => typeof wish === "object" && wish !== null);
  } catch {
    return [];
  }
}

function persistLocalFallback() {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(wishes));
}

function formatCurrency(number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(number);
}
