/**
 * 교사쉼터 자동 콘텐츠 생성 스크립트 (v4 - 확정판)
 *
 * 하루 1개씩 돌아가며 생성:
 *   월/목: 교육 정책/뉴스
 *   화/금: 교사 생활 팁/노하우
 *   수/토: 수업 자료/이슈 큐레이션
 *   일: 휴무
 *
 * 흐름:
 * 1. 오늘 요일에 맞는 콘텐츠 유형 결정
 * 2. 봇 로그인 → accessToken 발급
 * 3. Claude API (웹검색) → 콘텐츠 1개 생성
 * 4. DRAFT로 저장 → 관리자 승인 후 공개
 */

const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic();

const API_URL = process.env.TEACHER_SHELTER_API_URL;
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
  if (!data.accessToken) {
    throw new Error("accessToken 없음: " + JSON.stringify(data));
  }

  console.log("✅ 봇 로그인 성공");
  return data.accessToken;
}

// ─────────────────────────────────────────────
// 콘텐츠 유형 정의
// ─────────────────────────────────────────────

const CONTENT_TYPES = {
  policy_news: {
    category: "INFO",
    label: "교육 정책/뉴스",

    userMessage: `오늘 또는 최근 3일 이내 한국 교육부, 보건복지부, 시도교육청에서 
발표한 특수교육 또는 보육 관련 정책, 제도 변경, 공지사항을 검색하고,
특수아동교사와 보육교사를 위한 정보성 글 1개를 작성해주세요.

검색 키워드: 특수교육 정책 2026, 보육교사 제도, 어린이집 정책 변경, 장애아 보육`,

    systemPrompt: `당신은 특수교육과 보육 분야의 교육 정책을 10년간 취재해온 교육 전문 기자입니다.
복잡한 정책을 현장 교사가 "나한테 어떤 영향이 있지?"를 바로 알 수 있도록 쉽고 정확하게 풀어 설명합니다.

글쓰기 규칙:
- 톤: 정보 전달 중심, 객관적이되 딱딱하지 않게
- 구조: [정책 요약] → [교사에게 미치는 영향] → [앞으로 일정/참고사항]
- 길이: 800~1,200자
- 문단: 3~4문장 단위로 짧게

환각 방지 규칙:
- 웹검색으로 확인된 사실만 작성. 검색 결과에 없는 날짜, 법률명, 수치, 기관명을 만들어내지 말 것
- 수치는 검색 결과 원문에 있는 것만 인용. 없으면 "구체적 수치는 해당 기관 공지를 확인해주세요"로 대체
- "모든 교사가 반드시~" 같은 절대적 표현 금지
- 출처를 반드시 포함
- 검색 결과가 부족하면 솔직히 없다고 알리고, 가장 가까운 관련 정보로 대체`,
  },

  teacher_tips: {
    category: "KNOWHOW",
    label: "교사 생활 팁/노하우",

    userMessage: `한국 특수교사, 보육교사, 어린이집 교사가 현장에서 겪는 
실질적인 고민과 해결 노하우를 검색하고,
교사들에게 도움이 되는 실용적인 팁 글 1개를 작성해주세요.

검색 키워드: 보육교사 팁, 특수교사 노하우, 어린이집 교사 스트레스, 장애아동 지도 방법, 학부모 상담 요령`,

    systemPrompt: `당신은 특수아동교사와 보육교사를 위한 실용 칼럼니스트입니다.
어린이집과 특수학급 현장에서 매일 반복되는 고민들을 구체적인 해결 방법과 함께 풀어냅니다.

글쓰기 규칙:
- 톤: "선배 교사가 후배에게 조언하듯" 따뜻하고 실용적
- 구조: [공감 도입] → [구체적 팁 2~3가지] → [마무리 격려]
- "아, 이건 나도 겪어봤는데" 싶은 구체적 상황 예시 포함
- 길이: 800~1,200자

환각 방지 규칙:
- 특정 법률, 제도, 수당 금액은 웹검색으로 확인된 것만 작성. 확인 안 되면 "정확한 금액은 소속 기관에 확인해주세요"
- 의학적/심리학적 조언 금지. "전문가 상담을 권합니다" 형태로 안내
- "이렇게 하면 반드시 효과가 있다" 같은 보장성 표현 금지
- 출처가 있으면 명시, 일반 경험담은 "많은 선생님들의 경험에 따르면" 형태`,
  },

  resource_curation: {
    category: "INFO",
    label: "수업 자료/이슈 큐레이션",

    userMessage: `한국 특수교육, 장애아동 보육, 어린이집 교육과정 관련 
최신 자료, 연수 정보, 커뮤니티 이슈를 검색하고,
교사들이 바로 활용할 수 있는 정보 큐레이션 글 1개를 작성해주세요.

검색 키워드: 특수교육 수업자료 2026, 보육교사 연수, 누리과정 자료, 장애아동 교구`,

    systemPrompt: `당신은 특수교육과 보육 분야의 교육 자료 큐레이터입니다.
흩어져 있는 유용한 자료와 정보를 모아서 교사들이 바로 활용할 수 있도록 정리합니다.

글쓰기 규칙:
- 톤: 정보 큐레이션, 깔끔하고 실용적
- 구조: [이슈/자료 소개] → [핵심 내용 요약] → [활용 방법 또는 링크]
- 길이: 800~1,200자

환각 방지 규칙:
- 실제 검색으로 확인된 자료/연수만 소개. 존재하지 않는 사이트, 프로그램, 교구를 만들어내지 말 것
- 무료/유료, 신청 기간 등은 검색 결과에 있는 것만 기재. 없으면 "해당 사이트에서 확인해주세요"
- URL은 검색 결과에서 확인된 것만 사용. 추측으로 URL을 구성하지 말 것
- 광고 톤 금지`,
  },
};

// ─────────────────────────────────────────────
// 오늘 요일에 맞는 콘텐츠 유형 선택
// ─────────────────────────────────────────────

function getTodayContentType() {
  const day = new Date().getDay(); // 0=일, 1=월, ...

  const schedule = {
    0: null, // 일: 휴무
    1: "policy_news", // 월: 정책
    2: "teacher_tips", // 화: 팁
    3: "resource_curation", // 수: 자료
    4: "policy_news", // 목: 정책
    5: "teacher_tips", // 금: 팁
    6: "resource_curation", // 토: 자료
  };

  return schedule[day];
}

// ─────────────────────────────────────────────
// 공통 출력 형식 (system prompt 뒤에 붙임)
// ─────────────────────────────────────────────

const OUTPUT_RULE = `

출력 규칙:
- 반드시 JSON 한 개만 반환할 것. JSON 앞뒤에 설명, 인사말, 마크다운 코드블록(\`\`\`) 붙이지 말 것.
- content 필드의 본문은 반드시 마크다운 형식으로 작성할 것:
  - 문단 사이에 빈 줄(\\n\\n)을 넣어 구분할 것
  - 소제목이 있으면 ## 또는 ### 사용
  - 핵심 내용은 **굵게** 강조
  - 목록이 필요하면 - 사용
- 검색 결과가 부족해서 글을 쓸 수 없으면: {"skip":true,"reason":"사유"}

JSON 형식:
{"title":"25~35자 제목","content":"800~1200자 본문(마크다운)","category":"INFO또는KNOWHOW","sourceUrl":"출처URL또는빈문자열","sourceName":"출처명","confidence":"high또는medium"}

confidence: high=공식기관 출처, medium=비공식 출처`;

// ─────────────────────────────────────────────
// Claude API 호출 → 콘텐츠 생성
// ─────────────────────────────────────────────

async function generateContent(typeKey) {
  const contentType = CONTENT_TYPES[typeKey];
  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  console.log(`[${contentType.label}] 생성 시작...`);

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    system: contentType.systemPrompt + OUTPUT_RULE,
    messages: [
      {
        role: "user",
        content: `오늘은 ${today}입니다.

${contentType.userMessage}

교사쉼터(teacherlounge.co.kr) 커뮤니티에 올릴 글입니다.
본문에 "특수교사", "보육교사", "어린이집 교사" 중 적절한 키워드를 자연스럽게 포함해주세요.

JSON만 반환하세요.`,
      },
    ],
  });

  // 텍스트 블록 추출
  const textBlocks = response.content.filter((b) => b.type === "text");
  if (textBlocks.length === 0) {
    throw new Error("텍스트 응답 없음");
  }

  const rawText = textBlocks.map((b) => b.text).join("");

  // JSON 추출: 코드블록 → 중괄호 → 실패
  let jsonStr = "";

  const codeBlock = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    jsonStr = codeBlock[1].trim();
  } else {
    const braces = rawText.match(/\{[\s\S]*\}/);
    if (braces) {
      jsonStr = braces[0];
    } else {
      throw new Error("JSON 형식 응답을 찾을 수 없음");
    }
  }

  const result = JSON.parse(jsonStr);

  // skip 체크
  if (result.skip) {
    console.log(`[${contentType.label}] 건너뜀: ${result.reason}`);
    return null;
  }

  // 필수 필드 확인
  if (!result.title || !result.content) {
    throw new Error("title 또는 content 없음");
  }

  // 글자 수 확인
  if (result.content.length < 300) {
    throw new Error(`글이 너무 짧음 (${result.content.length}자)`);
  }

  console.log(
    `[${contentType.label}] ✅ "${result.title}" (${result.content.length}자, ${result.confidence})`,
  );

  return {
    title: result.title,
    content: result.content,
    category: result.category || contentType.category,
    sourceUrl: result.sourceUrl || "",
    sourceName: result.sourceName || "",
    confidence: result.confidence || "medium",
  };
}

// ─────────────────────────────────────────────
// DRAFT로 게시
// ─────────────────────────────────────────────

async function postAsDraft(content, accessToken) {
  const res = await fetch(`${API_URL}/api/admin/auto-content`, {
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
      sourceUrl: content.sourceUrl,
      sourceName: content.sourceName,
      confidence: content.confidence,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`게시 실패 (${res.status}): ${err}`);
  }

  const data = await res.json();
  console.log(`[게시] ✅ DRAFT 저장 (ID: ${data.id || "N/A"})`);
  return true;
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────

async function main() {
  console.log("=== 교사쉼터 콘텐츠 생성 ===");
  console.log(`시간: ${new Date().toISOString()}`);

  // 1. 오늘 콘텐츠 유형 확인
  const typeKey = getTodayContentType();
  if (!typeKey) {
    console.log("오늘은 일요일. 휴무.");
    return;
  }
  console.log(`오늘 유형: ${CONTENT_TYPES[typeKey].label}\n`);

  // 2. 봇 로그인
  let accessToken = null;
  if (API_URL && BOT_PASSWORD) {
    accessToken = await login();
  } else {
    console.log("⚠️ 환경변수 없음. 로컬 테스트 모드.\n");
  }

  // 3. 콘텐츠 생성
  try {
    const content = await generateContent(typeKey);

    if (!content) {
      console.log("\n=== 결과: 검색 결과 부족으로 건너뜀 ===");
      return;
    }

    // 4. 게시
    if (accessToken) {
      await postAsDraft(content, accessToken);
      console.log("\n=== 결과: DRAFT 1개 저장 완료 ===");
    } else {
      console.log("[로컬] 결과:", JSON.stringify(content, null, 2));
    }
  } catch (error) {
    console.error(`\n❌ 실패: ${error.message}`);
    process.exit(1);
  }
}

main();
