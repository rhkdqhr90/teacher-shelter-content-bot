/**
 * 교사쉼터 자동 콘텐츠 생성 스크립트 (v3 - 확정판)
 *
 * 흐름:
 * 1. POST /api/auth/login → accessToken 발급
 * 2. Claude API (웹검색) → 콘텐츠 3개 생성
 * 3. POST /api/posts (status: DRAFT) → 임시저장
 * 4. 관리자가 어드민에서 승인 → 공개
 */

const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic();

const API_URL = process.env.TEACHER_SHELTER_API_URL; // https://api.teacherlounge.co.kr
const BOT_EMAIL = process.env.BOT_EMAIL || "bot@teacherlounge.co.kr";
const BOT_PASSWORD = process.env.BOT_PASSWORD;
const ORIGIN = "https://www.teacherlounge.co.kr";

// ─────────────────────────────────────────────
// 봇 로그인
// ─────────────────────────────────────────────

async function login() {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
    },
    body: JSON.stringify({ email: BOT_EMAIL, password: BOT_PASSWORD }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`로그인 실패 (${res.status}): ${err}`);
  }

  const data = await res.json();
  const token = data.accessToken;

  if (!token) {
    throw new Error("accessToken 없음: " + JSON.stringify(data));
  }

  console.log("✅ 봇 로그인 성공");
  return token;
}

// ─────────────────────────────────────────────
// 콘텐츠 유형별 프롬프트
// ─────────────────────────────────────────────

const CONTENT_TYPES = [
  {
    id: "policy_news",
    category: "INFO",
    label: "교육 정책/뉴스",
    searchQuery: `오늘 또는 최근 3일 이내 한국 교육부, 보건복지부, 시도교육청에서 
발표한 특수교육 또는 보육 관련 정책, 제도 변경, 공지사항을 검색해주세요.
검색 키워드: 특수교육 정책 2026, 보육교사 제도, 어린이집 정책 변경, 장애아 보육`,

    systemPrompt: `## 페르소나

당신은 특수교육과 보육 분야의 교육 정책을 10년간 취재해온 
교육 전문 기자입니다. 복잡한 정책을 현장 교사가 
"나한테 어떤 영향이 있지?"를 바로 알 수 있도록 
쉽고 정확하게 풀어 설명하는 것이 강점입니다.

## 글쓰기 규칙

- 톤: 정보 전달 중심, 객관적이되 딱딱하지 않게
- 구조: [정책 요약] → [교사에게 미치는 영향] → [앞으로 일정/참고사항]
- 길이: 800~1,200자 (모바일 가독성 고려)
- 문단: 3~4문장 단위로 짧게 끊기

## 환각 방지 규칙 (가장 중요)

1. 웹검색으로 확인된 사실만 작성할 것. 검색 결과에 없는 날짜, 
   법률명, 수치, 기관명을 절대 만들어내지 말 것
2. 정책 시행일, 예산 규모, 대상자 수 등 수치는 
   검색 결과 원문에 있는 것만 인용. 없으면 "구체적 수치는 
   해당 기관 공지를 확인해주세요"로 대체
3. "모든 교사가 반드시~" 같은 절대적 표현 금지.
   "해당되는 선생님은~", "~에 해당하는 경우" 형태 사용
4. 출처 URL을 반드시 포함. URL을 확인할 수 없으면 
   기관명만이라도 명시
5. 검색 결과가 불충분하면 "최근 관련 발표를 찾지 못했습니다"라고 
   솔직히 알리고, 대신 가장 가까운 관련 정보로 대체할 것`,
  },

  {
    id: "teacher_tips",
    category: "KNOWHOW",
    label: "교사 생활 팁/노하우",
    searchQuery: `한국 특수교사, 보육교사, 어린이집 교사가 현장에서 겪는 
실질적인 고민과 해결 노하우를 검색해주세요. 
검색 키워드: 보육교사 팁, 특수교사 노하우, 어린이집 교사 스트레스, 
장애아동 지도 방법, 학부모 상담 요령, 보육교사 서류 업무`,

    systemPrompt: `## 페르소나

당신은 특수아동교사와 보육교사를 위한 실용 칼럼니스트입니다.
어린이집과 특수학급 현장에서 매일 반복되는 고민들을 
구체적인 해결 방법과 함께 풀어내는 것이 전문입니다.

## 글쓰기 규칙

- 톤: "선배 교사가 후배에게 조언하듯" 따뜻하고 실용적
- 구조: [공감 도입] → [구체적 팁 2~3가지] → [마무리 격려]
- "아, 이건 나도 겪어봤는데" 싶은 구체적 상황 예시 포함
- 길이: 800~1,200자
- 문단: 3~4문장 단위

## 환각 방지 규칙

1. 특정 법률, 제도, 수당 금액을 언급할 때는 
   웹검색으로 확인된 것만 작성. 확인 안 되면 
   "정확한 금액은 소속 기관에 확인해주세요" 처리
2. 의학적/심리학적 조언은 절대 하지 말 것. 
   "전문가 상담을 권합니다" 형태로 안내
3. "이렇게 하면 반드시 효과가 있다" 같은 보장성 표현 금지.
   "도움이 될 수 있습니다", "시도해볼 만합니다" 형태 사용
4. 출처가 있는 정보는 출처를 명시하고, 
   일반적 경험담은 "많은 선생님들의 경험에 따르면" 형태 사용`,
  },

  {
    id: "resource_curation",
    category: "INFO",
    label: "수업 자료/이슈 큐레이션",
    searchQuery: `한국 특수교육, 장애아동 보육, 어린이집 교육과정 관련 
최신 자료, 연수 정보, 커뮤니티 이슈를 검색해주세요.
검색 키워드: 특수교육 수업자료 2026, 보육교사 연수, 
누리과정 자료, 장애아동 교구, 어린이집 프로그램, 특수교사 커뮤니티`,

    systemPrompt: `## 페르소나

당신은 특수교육과 보육 분야의 교육 자료 큐레이터입니다.
흩어져 있는 유용한 자료와 정보를 모아서 
교사들이 바로 활용할 수 있도록 정리하는 것이 전문입니다.

## 글쓰기 규칙

- 톤: 정보 큐레이션, 깔끔하고 실용적
- 구조: [이슈/자료 소개] → [핵심 내용 요약] → [활용 방법 또는 링크]
- 여러 소스를 종합한 "이번 주 알아두면 좋을 것들" 형태도 가능
- 길이: 800~1,200자
- 문단: 3~4문장 단위

## 환각 방지 규칙

1. 자료/연수 추천 시 실제 검색으로 확인된 것만 소개.
   존재하지 않는 사이트, 프로그램, 교구를 만들어내지 말 것
2. 무료/유료 여부, 신청 기간 등은 검색 결과에 있는 것만 기재.
   없으면 "상세 조건은 해당 사이트에서 확인해주세요"
3. URL을 제시할 때 검색 결과에서 확인된 URL만 사용.
   추측으로 URL을 구성하지 말 것
4. 특정 상품/서비스를 광고하는 톤이 되지 않도록 주의`,
  },
];

// ─────────────────────────────────────────────
// 공통 출력 형식
// ─────────────────────────────────────────────

const OUTPUT_FORMAT = `
## 출력 형식 (반드시 이 JSON 구조만 반환할 것)

마크다운 코드블록이나 다른 텍스트 없이 JSON만 반환하세요.

{
  "title": "(25~35자, 교사가 클릭하고 싶은 제목. 낚시성/과장 금지)",
  "content": "(800~1200자, 마크다운 형식. 문단은 \\n\\n으로 구분)",
  "category": "INFO 또는 KNOWHOW",
  "sourceUrl": "원본 출처 URL (확인된 것만. 없으면 빈 문자열)",
  "sourceName": "출처 기관/사이트명",
  "confidence": "high 또는 medium"
}

confidence 기준:
- high: 공식 기관 발표 또는 검증된 출처 기반
- medium: 블로그/커뮤니티 등 비공식 출처 기반

검색 결과가 불충분하면:
{ "skip": true, "reason": "사유" }
`;

// ─────────────────────────────────────────────
// Claude API로 콘텐츠 생성
// ─────────────────────────────────────────────

async function generateContent(contentType) {
  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  console.log(`\n[${contentType.label}] 생성 시작...`);

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: contentType.systemPrompt + OUTPUT_FORMAT,
      messages: [
        {
          role: "user",
          content: `오늘은 ${today}입니다.

${contentType.searchQuery}

위 검색 결과를 바탕으로, 특수아동교사와 보육교사를 위한 
교사쉼터(teacherlounge.co.kr) 커뮤니티에 올릴 글 1개를 작성해주세요.

SEO 키워드를 본문에 자연스럽게 2~3회 포함해주세요:
"특수교사", "보육교사", "어린이집 교사", "교사쉼터" 중 적절한 것

반드시 JSON만 반환해주세요.`,
        },
      ],
    });

    const textBlocks = response.content.filter((b) => b.type === "text");
    if (textBlocks.length === 0) return null;

    const rawText = textBlocks.map((b) => b.text).join("");
    const cleanText = rawText.replace(/```json\s*|```\s*/g, "").trim();
    const result = JSON.parse(cleanText);

    if (result.skip) {
      console.log(`[${contentType.label}] 건너뜀: ${result.reason}`);
      return null;
    }

    if (!result.title || !result.content || result.content.length < 400) {
      console.log(`[${contentType.label}] 품질 기준 미달`);
      return null;
    }

    console.log(
      `[${contentType.label}] ✅ "${result.title}" (${result.content.length}자)`,
    );
    return { ...result, contentType: contentType.id };
  } catch (error) {
    console.error(`[${contentType.label}] ❌ ${error.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────
// DRAFT 상태로 게시
// ─────────────────────────────────────────────

async function postAsDraft(content, accessToken) {
  try {
    const res = await fetch(`${API_URL}/api/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        title: content.title,
        content: content.content,
        category: content.category,
        status: "DRAFT",
        isAutoGenerated: true,
        sourceUrl: content.sourceUrl || "",
        sourceName: content.sourceName || "",
        confidence: content.confidence || "medium",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[게시] 실패 (${res.status}): ${err}`);
      return false;
    }

    const data = await res.json();
    console.log(
      `[게시] ✅ DRAFT 저장: "${content.title}" (ID: ${data.id || "N/A"})`,
    );
    return true;
  } catch (error) {
    console.error(`[게시] ❌ ${error.message}`);
    return false;
  }
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────

async function main() {
  console.log("=== 교사쉼터 콘텐츠 생성 시작 ===");
  console.log(`시간: ${new Date().toISOString()}\n`);

  // 1. 봇 로그인
  let accessToken = null;
  if (API_URL && BOT_PASSWORD) {
    try {
      accessToken = await login();
    } catch (error) {
      console.error("봇 로그인 실패:", error.message);
      process.exit(1);
    }
  } else {
    console.log("⚠️ 환경변수 없음. 로컬 테스트 모드.\n");
  }

  // 2. 콘텐츠 생성 + 게시
  const results = { success: 0, skipped: 0, failed: 0 };

  for (const contentType of CONTENT_TYPES) {
    const content = await generateContent(contentType);

    if (!content) {
      results.skipped++;
      continue;
    }

    if (accessToken) {
      const posted = await postAsDraft(content, accessToken);
      posted ? results.success++ : results.failed++;
    } else {
      console.log("[로컬] 생성 결과:", JSON.stringify(content, null, 2));
      results.success++;
    }

    await new Promise((r) => setTimeout(r, 3000));
  }

  // 3. 결과
  console.log("\n=== 결과 ===");
  console.log(
    `DRAFT 저장: ${results.success} | 건너뜀: ${results.skipped} | 실패: ${results.failed}`,
  );

  if (results.success === 0 && results.failed > 0) process.exit(1);
}

main();
