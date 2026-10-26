/* Full-screen menu, base and settings. Inventory supports drag and tap-to-move. */
(() => {
  "use strict";
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  class CampaignScreens {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.page = "menu";
      this.tab = "warehouse";
      this.selected = null;
      this.fusion = [];
      this.risks = 0;
      root.addEventListener("click", (e) => this.click(e));
      root.addEventListener("input", (e) => this.setting(e));
      root.addEventListener("dragstart", (e) => {
        const n = e.target.closest("[data-entry]");
        if (n) {
          e.dataTransfer.setData("text/plain", n.dataset.entry);
          this.dragId = n.dataset.entry;
        }
      });
      root.addEventListener("dragover", (e) => {
        if (e.target.closest("[data-container]")) e.preventDefault();
      });
      root.addEventListener("drop", (e) => {
        const n = e.target.closest("[data-container]");
        if (n) {
          e.preventDefault();
          this.act(
            Campaign.move(
              this.api.save(),
              e.dataTransfer.getData("text/plain"),
              n.dataset.container,
            ),
          );
        }
      });
      root.addEventListener("pointerdown", (e) => {
        const n = e.target.closest("[data-move-grip]");
        if (n) {
          this.pointer = {
            id: e.pointerId,
            uid: n.closest("[data-entry]").dataset.entry,
            x: e.clientX,
            y: e.clientY,
            lastY: e.clientY,
            active: false,
          };
          const scroll = () => {
            const p = this.pointer;
            if (!p) return;
            if (p.active) {
              if (p.lastY > innerHeight - 65) root.scrollTop += 14;
              else if (p.lastY < 70) root.scrollTop -= 14;
            }
            requestAnimationFrame(scroll);
          };
          requestAnimationFrame(scroll);
          try {
            n.setPointerCapture(e.pointerId);
          } catch {}
        }
      });
      root.addEventListener("pointermove", (e) => {
        if (this.pointer && e.pointerId === this.pointer.id) {
          e.preventDefault();
          this.pointer.lastY = e.clientY;
          if (
            Math.hypot(e.clientX - this.pointer.x, e.clientY - this.pointer.y) >
            12
          )
            this.pointer.active = true;
          root.classList.add("moving-entry");
        }
      });
      root.addEventListener("pointerup", (e) => {
        const p = this.pointer;
        this.pointer = null;
        root.classList.remove("moving-entry");
        if (!p) return;
        const n = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest("[data-container]");
        if (n && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12)
          this.act(Campaign.move(this.api.save(), p.uid, n.dataset.container));
      });
      root.addEventListener("pointercancel", () => {
        this.pointer = null;
        root.classList.remove("moving-entry");
      });
    }
    save() {
      return this.api.save();
    }
    c() {
      return this.save().campaign;
    }
    act(result) {
      if (result?.ok === false) this.api.message(result.error);
      else this.api.persist();
      this.render();
    }
    show(page = "menu", tab) {
      this.page = page;
      if (tab) this.tab = tab;
      this.selected = null;
      this.root.classList.remove("hidden");
      document.body.dataset.screen = page;
      document
        .querySelectorAll("main,.topbar,footer")
        .forEach((n) => (n.inert = true));
      this.root.scrollTop = 0;
      this.render();
      this.root.tabIndex = -1;
      this.root.focus({ preventScroll: true });
    }
    hide() {
      this.root.classList.add("hidden");
      document
        .querySelectorAll("main,.topbar,footer")
        .forEach((n) => (n.inert = false));
      delete document.body.dataset.screen;
    }
    tile(id, select = false) {
      const x = Campaign.entity(this.save(), id),
        d = Campaign.definition(this.save(), id);
      if (!x || !d) return "";
      return `<button class="inventory-tile ${this.selected === id || this.fusion.includes(id) ? "chosen" : ""}" data-entry="${id}" ${x.rarity ? `data-detail-card="${id}"` : ""} data-rank="${x.rarity || "item"}" ${select ? 'data-fuse="true"' : ""} draggable="true" aria-label="${esc(d.name)} 선택"><span class="move-grip" data-move-grip aria-hidden="true">⠿</span>${GameArt.visual(x.rarity ? "card" : "item", x.templateId, d.icon || "cards")}<strong>${esc(d.name)}</strong><small>${x.rarity ? (x.loan ? "대여 · " : "") + this.api.rarity(x.rarity) : d.kind === "material" ? `재료 ×${x.qty}` : d.kind === "weapon" ? "무기" : d.kind === "armor" ? "방어구" : d.kind === "backpack" ? "배낭" : "아이템"}</small></button>`;
    }
    inventory(location) {
      const c = this.c(),
        ids = c[location],
        cap =
          location === "stash" ? c.capacity : Campaign.capacity(this.save());
      return `<section class="storage-panel" data-container="${location}"><div class="storage-title"><h3>${location === "stash" ? "창고" : "탐사 배낭"} <small>${ids.length}/${cap}</small></h3>${location === "stash" ? '<button data-action="sort">정렬</button>' : '<button data-action="all-stash">모두 창고로</button>'}</div><div class="inventory-grid">${ids.map((id) => this.tile(id)).join("")}${Array.from({ length: Math.max(0, cap - ids.length) }, () => '<span class="empty-slot" aria-hidden="true"></span>').join("")}</div><button class="transfer-button" data-transfer="${location}" ${!this.selected ? "disabled" : ""}>선택한 물건을 ${location === "stash" ? "창고" : "배낭"}로 이동</button></section>`;
    }
    equipment() {
      const names = {
        primary: "주무기 1",
        secondary: "주무기 2",
        armor: "방어구",
        backpack: "배낭",
      };
      return `<div class="equipment-slots">${Object.entries(names)
        .map(([slot, name]) => {
          const id = this.c().equipment[slot],
            d = id && Campaign.definition(this.save(), id);
          return `<button data-equip="${slot}">${d ? GameArt.visual("item", Campaign.entity(this.save(), id).templateId, d.icon, "equipment-art") : ""}<small>${name}</small><strong>${esc(d?.name || "비어 있음")}</strong><span>${esc(d?.desc || "배낭에서 장비 선택 후 장착")}</span></button>`;
        })
        .join("")}</div>`;
    }
    detail() {
      const d =
          this.selected && Campaign.definition(this.save(), this.selected),
        x = this.selected && Campaign.entity(this.save(), this.selected);
      if (!d)
        return '<div class="selection-detail">물건을 선택하고 이동하거나, ⠿ 손잡이로 반대편 보관 공간에 놓으세요.</div>';
      const detail = x.rarity ? this.api.details(this.selected) : null;
      return `<div class="selection-detail" role="status"><strong>${esc(d.name)}</strong><div class="quick-transfer"><button data-transfer="pack">← 배낭으로</button><button data-transfer="stash">창고로 →</button></div><p>${esc(detail ? detail.description : d.desc)}</p>${detail ? detail.sections.map((section) => `<details><summary>${esc(section.title)}</summary>${section.items.map((t) => `<p>${esc(t)}</p>`).join("")}</details>`).join("") : ""}</div>`;
    }
    shop() {
      if (!this.c().facilities.shop) return this.building("shop");
      const s = this.save();
      return `<div class="shop-layout"><section><h3>물자 거래</h3><div class="shop-offers">${[
        ...Object.keys(CardLibrary.templates).map((id) => ["card", id]),
        ...Object.keys(Campaign.items).map((id) => ["item", id]),
      ]
        .map(([kind, id]) => {
          const d =
              kind === "card" ? CardLibrary.templates[id] : Campaign.items[id],
            price =
              kind === "card"
                ? 50 + CardLibrary.rarities.indexOf(d.rarity) * 35
                : d.price;
          return `<article>${GameArt.visual(kind, id, d.icon, "compact-art")}<div><strong>${esc(d.name)}</strong><small>${esc(kind === "card" ? this.api.brief(CardLibrary.compile(id)) : d.desc)}</small></div><button data-buy="${kind}:${id}">${price} CR 구매</button></article>`;
        })
        .join("")}</div></section><section><h3>상인 의뢰</h3>${Object.entries(
        Campaign.quests,
      )
        .map(
          ([id, q]) =>
            `<article class="quest"><strong>${q.name}</strong><p>${q.desc}</p><small>${q.reward} CR${q.capacity ? ` · 창고 +${q.capacity}칸` : ""}</small><button data-quest="${id}" ${this.c().quests[id] === "done" ? "disabled" : ""}>${this.c().quests[id] === "done" ? "완료" : this.c().quests[id] ? (Campaign.questReady(s, id) ? "보상 받기" : "진행 중") : "수락"}</button></article>`,
        )
        .join(
          "",
        )}<h3>판매할 물건 선택</h3><div class="inventory-grid sale-grid">${[...this.c().stash, ...this.c().pack].map((id) => this.tile(id)).join("")}</div><button data-action="sell" ${!this.selected ? "disabled" : ""}>선택 물건 판매</button></section></div>`;
    }
    building(id) {
      return `<section class="facility-build"><svg><use href="#i-${id === "shop" ? "box" : "shield"}"/></svg><h3>${id === "shop" ? "상점" : "강화소"} 건설</h3><p>${id === "shop" ? "카드·장비 거래와 상인 의뢰를 이용합니다." : "카드 승급과 재료를 사용한 능력 강화를 이용합니다."}</p><button data-build="${id}">무료 건설</button><small>건설 재료는 테스트 기간 동안 필요하지 않습니다.</small></section>`;
    }
    forge() {
      if (!this.c().facilities.forge) return this.building("forge");
      const first = this.save().instances.find((x) => x.uid === this.fusion[0]),
        next = first
          ? CardLibrary.rarities[
              Math.min(5, CardLibrary.rarities.indexOf(first.rarity) + 1)
            ]
          : null,
        cap = next
          ? CardLibrary.riskCapacity(next) -
            (first.rarity === "mystic" ? 0 : first.risks.length)
          : 0;
      this.risks = Math.min(this.risks, Math.max(0, cap));
      return `<div class="forge-layout"><section><h3>같은 등급 카드 3장</h3><p>첫 선택이 기준 카드입니다. 고유 효과를 유지하며 나머지 2장을 소모합니다.</p><div class="inventory-grid">${[
        ...this.c().pack,
        ...this.c().stash,
      ]
        .filter((id) => this.save().instances.some((x) => x.uid === id))
        .map((id) => this.tile(id, true))
        .join(
          "",
        )}</div></section><section class="forge-preview"><h3>${first ? esc(CardLibrary.templates[first.templateId].name) : "기준 카드를 선택하세요"}</h3><p>선택 ${this.fusion.length}/3 · ${first ? this.api.rarity(first.rarity) + " → " + this.api.rarity(next) : "승급 실패 없음"}</p><label>추가 리스크 <select id="forge-risk">${Array.from({ length: Math.max(0, cap) + 1 }, (_, i) => `<option value="${i}" ${i === this.risks ? "selected" : ""}>${i}개 / 추가 옵션 ${i}개</option>`).join("")}</select></label><p>${first?.rarity === "mystic" ? `기존 옵션·리스크를 교체하여 기본 5개 + 추가 ${this.risks}개로 재구성합니다.` : "기존 옵션의 등급과 수치를 유지하고 새 옵션 1개를 추첨합니다."}</p><button data-action="promote" ${this.fusion.length === 3 ? "" : "disabled"}>선택 3장을 합성 · 성공 100%</button><button data-action="clear-fusion">선택 취소</button><details><summary>테스트용 옵션 등급 확률</summary>${Object.entries(
        Campaign.tuning.optionTables,
      )
        .map(
          ([stage, weights]) =>
            `<p>${this.api.rarity(stage)} 승급: ${weights
              .map((v, i) =>
                v ? this.api.rarity(CardLibrary.rarities[i]) + v + "%" : "",
              )
              .filter(Boolean)
              .join(" · ")}</p>`,
        )
        .join(
          "",
        )}</details>${this.selected ? this.detail() : ""}<p class="prototype-note">확률·옵션 수치·새 리스크는 플레이 테스트용 임시 설정입니다.</p></section></div>`;
    }
    upgrades() {
      return `<div class="upgrade-cards">${[
        ["health", "체력 강화", "최대 체력 +10", 100, 3],
        ["armor", "장갑 강화", "기본 장갑 +1", 150, 4],
        ["warehouse", "창고 확장", "창고 +12칸", 50, 2],
      ]
        .map(
          ([id, name, desc, price, n]) =>
            `<article><h3>${name}</h3><p>${desc}</p><small>${price} CR · 금속 부품 ${n}개</small><button data-upgrade="${id}" ${this.c().facilities.forge ? "" : "disabled"}>강화</button></article>`,
        )
        .join(
          "",
        )}</div><p>보유 금속 부품 ${Campaign.materialCount(this.save(), "scrap")}개 · 체력 강화 ${this.c().upgrades.health} · 장갑 강화 ${this.c().upgrades.armor}</p>`;
    }
    render() {
      const s = this.save(),
        c = this.c();
      if (this.page === "menu") {
        this.root.innerHTML = `<section class="menu-scene"><div class="menu-content"><p class="eyebrow">TACTICAL CARD EXTRACTION</p><h1><small>ESCAPE FROM</small>CARDKOV</h1><p>카드를 장전하고, 전리품을 챙겨 돌아오세요.</p><div class="menu-buttons">${c.run ? '<button data-action="resume" class="primary-btn">진행 중 탐사 계속</button>' : ""}<button data-action="deploy" class="primary-btn" ${c.run ? "disabled" : ""}>탐사 시작 →</button><button data-page="base" ${c.run ? "disabled" : ""}>기지</button><button data-page="settings">환경 설정</button><button data-page="exit">게임 종료</button></div><small>최고 도달 ${c.best}/3 · 생존 귀환 ${c.stats.extracts}회</small></div></section>`;
        return;
      }
      if (this.page === "exit") {
        this.root.innerHTML = `<div class="settings-scene"><section class="settings-card"><h2>작전 기록 저장 완료</h2><p>브라우저의 이 탭을 닫아 게임을 종료할 수 있습니다.</p><button data-page="menu">메인메뉴로</button></section></div>`;
        return;
      }
      if (this.page === "settings") {
        const x = c.settings;
        this.root.innerHTML = `<div class="settings-scene"><section class="settings-card"><h2>환경 설정</h2><label>사운드 <input type="checkbox" data-setting="sound" ${x.sound ? "checked" : ""}></label><label>음량 <input type="range" data-setting="volume" min="0" max="1" step=".05" value="${x.volume}"></label><label>글자 크기 <input type="range" data-setting="scale" min=".9" max="1.2" step=".05" value="${x.scale}"></label><label>애니메이션 <input type="checkbox" data-setting="motion" ${x.motion ? "checked" : ""}></label><label>배터리 절약 (30fps) <input type="checkbox" data-setting="battery" ${x.battery ? "checked" : ""}></label><button data-page="menu">뒤로</button></section></div>`;
        return;
      }
      this.root.innerHTML = `<div class="base-scene"><header class="base-heading"><div><small>SAFEHOUSE / OPERATIONS</small><h2>기지</h2></div><div>보관 자금 <b>${s.credits} CR</b><br><small>휴대금 ${c.cash} CR</small></div><button data-page="menu">뒤로</button></header><nav class="base-tabs">${[
        ["warehouse", "배낭·창고"],
        ["shop", "상점·의뢰"],
        ["forge", "카드 합성"],
        ["upgrades", "능력 강화"],
        ["build", "건설"],
      ]
        .map(
          ([id, name]) =>
            `<button data-tab="${id}" class="${id === this.tab ? "active" : ""}">${name}</button>`,
        )
        .join(
          "",
        )}</nav><div class="base-body">${this.tab === "warehouse" ? `${this.equipment()}<div class="money-controls"><button data-action="borrow">기본 대여 덱</button><button data-action="deposit">휴대금 전액 보관</button><button data-action="withdraw" ${s.credits < 50 ? "disabled" : ""}>50 CR 휴대</button><button data-action="deploy" class="primary-btn">탐사 시작</button></div>${this.detail()}<div class="storage-columns">${this.inventory("pack")}${this.inventory("stash")}</div>` : this.tab === "shop" ? this.shop() : this.tab === "forge" ? this.forge() : this.tab === "upgrades" ? this.upgrades() : `<div class="build-columns">${["shop", "forge"].map((id) => (this.c().facilities[id] ? `<section class="facility-build"><h3>${id === "shop" ? "상점" : "강화소"}</h3><p>건설 완료</p><button data-tab="${id}">입장</button></section>` : this.building(id))).join("")}</div>`}</div></div>`;
    }
    setting(e) {
      const n = e.target;
      if (n.id === "forge-risk") {
        this.risks = Number(n.value);
        this.render();
        return;
      }
      if (!n.dataset.setting) return;
      this.c().settings[n.dataset.setting] =
        n.type === "checkbox" ? n.checked : Number(n.value);
      this.api.settings();
      this.api.persist();
    }
    click(e) {
      if (e.target.closest("[data-move-grip]")) return;
      const n = e.target.closest("button");
      if (!n) return;
      const s = this.save(),
        c = this.c();
      if (n.dataset.page) {
        if (n.dataset.page === "exit") this.api.persist();
        this.show(n.dataset.page);
        return;
      }
      if (n.dataset.tab) {
        this.tab = n.dataset.tab;
        this.selected = null;
        this.render();
        return;
      }
      if (n.dataset.entry) {
        if (n.dataset.fuse) {
          const id = n.dataset.entry;
          if (this.fusion.includes(id))
            this.fusion = this.fusion.filter((x) => x !== id);
          else if (this.fusion.length < 3) this.fusion.push(id);
        } else
          this.selected =
            this.selected === n.dataset.entry ? null : n.dataset.entry;
        this.render();
        return;
      }
      if (n.dataset.transfer) {
        this.act(Campaign.move(s, this.selected, n.dataset.transfer));
        return;
      }
      if (n.dataset.equip) {
        this.act(
          this.selected
            ? Campaign.equip(s, this.selected, n.dataset.equip)
            : Campaign.unequip(s, n.dataset.equip),
        );
        return;
      }
      if (n.dataset.build) {
        Campaign.build(s, n.dataset.build);
        this.act({ ok: true });
        return;
      }
      if (n.dataset.buy) {
        const [kind, id] = n.dataset.buy.split(":");
        this.act(Campaign.buy(s, kind, id));
        return;
      }
      if (n.dataset.quest) {
        this.act(Campaign.quest(s, n.dataset.quest));
        return;
      }
      if (n.dataset.upgrade) {
        this.act(Campaign.upgrade(s, n.dataset.upgrade));
        return;
      }
      switch (n.dataset.action) {
        case "deploy":
          this.api.deploy();
          break;
        case "resume":
          this.api.resume();
          break;
        case "sort":
          Campaign.sort(s);
          this.act({ ok: true });
          break;
        case "all-stash": {
          const moved = Campaign.moveAll(s, "stash");
          this.api.message(`${moved}개 이동 · 남은 물건은 배낭에 보존됩니다.`);
          this.act({ ok: true });
          break;
        }
        case "borrow":
          this.act(Campaign.borrow(s));
          break;
        case "deposit":
          s.credits += c.cash;
          c.cash = 0;
          this.act({ ok: true });
          break;
        case "withdraw":
          if (s.credits >= 50) {
            s.credits -= 50;
            c.cash += 50;
            this.act({ ok: true });
          }
          break;
        case "sell":
          this.act(Campaign.sell(s, this.selected));
          break;
        case "promote": {
          const r = Campaign.promote(s, this.fusion, this.risks);
          if (r.ok) {
            this.fusion = [];
            this.risks = 0;
            this.selected = r.card.uid;
            this.api.message("승급 완료 · 기존 효과와 새 옵션을 확인하세요.");
          }
          this.act(r);
          break;
        }
        case "clear-fusion":
          this.fusion = [];
          this.risks = 0;
          this.render();
          break;
      }
    }
  }
  window.CampaignScreens = CampaignScreens;
})();
