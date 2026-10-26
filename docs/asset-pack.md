# Cardkov 에셋 팩

Escape from Cardkov의 현재 프로토타입에서 사용하는 원본 아트와 UI 리소스입니다. [에셋 보관소](../assets.html)에서 종류별로 살펴보고 [배포용 팩](../assets/cardkov-art-pack.zip)을 내려받을 수 있습니다.

## 아트 방향과 제작

타르코프의 절제된 군사·생존 분위기를 참고하되 Cardkov 전용 이미지로 제작했습니다. 낡은 올리브 도장, 어두운 강철, 콘크리트, 군용 직물, 오래된 종이가 공통 재질입니다. 차가운 자연광과 작은 주황색 작업등을 함께 사용합니다.

배경·카드 일러스트·장비·캐릭터·소품은 이미지 생성 도구 `imagegen`으로 새로 제작한 AI 생성 아트입니다. 웹 배포에는 크기와 용량을 조정한 WebP 파생 파일을 사용합니다. UI의 질감·휘장·프레임·아이콘은 이 프로젝트에서 제작한 SVG입니다. 다른 게임에서 추출한 이미지·로고·텍스처를 포함하지 않습니다.

실행 중에는 이미지 생성 API, 외부 이미지 서비스, 추가 라이브러리가 필요하지 않습니다. 이미지는 게임의 정적 파일로 제공되며 PC와 모바일 브라우저에서 동일한 에셋을 사용합니다.

배포용 WebP는 아틀라스를 포함해 38개, 약 2.24MiB입니다. UI는 SVG 15개이며 그중 아이콘 스프라이트 하나에 20종이 들어 있습니다. 다운로드 팩은 배포용 WebP·SVG, 미리보기 페이지와 스타일·경로 도우미·이 문서를 포함합니다. 생성 PNG 원본은 팩에 포함하지 않으며 작업 환경의 `generated_images/`에 보존했습니다. `tools/art-sources.json`은 원본 대응, `tools/build-art.cjs`는 분할·크기·WebP 변환 방법을 기록합니다.

## 파일 구성

| 위치 | 구성 | 게임에서 사용하는 곳 |
| --- | --- | --- |
| `assets/generated/menu.webp` | 폐쇄구역 검문소 | 메인메뉴, 설정 배경 |
| `assets/generated/base.webp` | 지하 작업실·물자 보관소 | 기지 |
| `assets/generated/environment-0.webp` | 외곽 경계 검문 창고 | 첫 전투 구역 |
| `assets/generated/environment-1.webp` | 화물 적재 시설 | 두 번째 전투 구역 |
| `assets/generated/environment-2.webp` | 심층 벙커 | 세 번째 전투 구역 |
| `assets/generated/cards/` | 12종 카드 템플릿 일러스트 | 손패, 카드 선택·보관·거래 |
| `assets/generated/items/` | 무기·방어구·배낭·재료·소모품·돈 | 장비 슬롯, 배낭·창고, 상점, 전리품 |
| `assets/generated/actors/` | 경계병·중장갑병·드론 | 전투의 독립 캐릭터 플레이트 |
| `assets/generated/props/` | 상자·기둥·단말기 | 전투의 독립 소품 플레이트, 상자 화면 |
| `assets/generated/field-plates.webp` | 캐릭터·소품 스프라이트 아틀라스 | 2.5D 캔버스 렌더러 |
| `assets/generated/weapon.webp` | 1인칭 무기와 장갑 낀 팔 | 전투의 전경 |
| `assets/generated/operator.webp` | 플레이어 초상 | 플레이어 HUD |
| `assets/ui/` | SVG 질감·프레임·아이콘 | 카드, HUD, 인벤토리, 메뉴 |

카드 파일명은 `shot`, `burst`, `guard`, `scan`, `heal`, `pierce`, `grenade`, `surge`, `suppress`, `breach`, `fieldAid`, `bulwark`입니다. 카드의 고유 ID나 강화 상태와 별개로, 동일한 템플릿은 같은 일러스트를 참조합니다.

아이템 파일명은 `rifle`, `carbine`, `pistol`, `vest`, `heavyVest`, `backpack`, `largePack`, `scrap`, `circuit`, `medkit`, `grenade`, `cash`입니다. 카드는 `cards/`, 아이템은 `items/`에 두므로 같은 `grenade` 이름도 구분됩니다.

## 고정 시점 2.5D 구성

전투 배경과 캐릭터·소품은 분리되어 있습니다. 카메라에 맞춰 자른 배경 위에 투명한 캐릭터와 소품을 세우고, 바닥 접점·그림자·깊이 순서·약한 공통 조명으로 공간을 만듭니다. 전경의 무기도 별도 플레이트입니다. 적의 HUD와 사용 가능한 카드 대상은 렌더링 이미지와 구분되는 실제 UI 요소로 유지합니다.

`field-plates.webp`는 기존 렌더러와 같은 여섯 개 셀을 사용합니다. 순서는 경계병, 중장갑병, 드론, 상자, 기둥, 단말기입니다. 독립 이미지 파일은 갤러리·UI·추후 편집에 사용할 수 있습니다. 아틀라스나 무기 이미지 로딩에 실패하면 기존 SVG 플레이트를 사용하며, 전투 배경 실패 시 기존 절차형 공간으로 복구합니다.

## UI와 가독성

카드 효과는 파란색 볼드, 상세의 추가 수치는 주황색으로 구분합니다. 설명이 많은 카드나 좁은 화면에서는 기존 정보 우선 배치를 유지하며 일러스트 영역을 줄이거나 숨깁니다. 장식 이미지에는 별도 설명을 중복하지 않고 인접한 제목·수치가 정보를 제공합니다.

여섯 등급은 금속 그라데이션 테두리와 SVG 모서리 장식으로 표시합니다. 노말은 강철색, 레어는 녹색, 에픽은 파랑, 유니크는 보라, 레전드리는 노랑, 미스틱은 빨강입니다. 색과 함께 등급명을 표시합니다.

`assets/ui/field-icons.svg`에는 체력·장갑·에너지·쉴드, 디버프, 카드 상태·옵션, 자금, 배낭·창고·강화소, 리롤·드로우·귀환 아이콘이 들어 있습니다. 상세 파일 안내와 호출 예시는 [UI 에셋 README](../assets/ui/README.md)를 참고하세요.
