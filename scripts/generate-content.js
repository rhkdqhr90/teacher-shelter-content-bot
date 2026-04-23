/**
 * 교사쉼터 자동 콘텐츠 생성 스크립트 (v5 - 품질 개선)
 *
 * 개선사항:
 * - 검색 키워드를 구체적 기관/사이트 지정
 * - 특수교사/보육교사 현장 맥락을 프롬프트에 직접 주입
 * - 팩트 인용 규칙 강화 (수치, 출처, 날짜 필수)
 * - 검색 결과가 부실하면 건너뛰기 강화
 */

const OpenAI = require("openai");

const client = new OpenAI();

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
// 콘텐츠 유형 정의 (v5 - 품질 개선)
// ─────────────────────────────────────────────

const CONTENT_TYPES = {
  policy_news: {
    category: "INFO",
    label: "교육 정책/뉴스",

    userMessage: `다음 검색을 순서대로 수행해주세요:

1차 검색: "교육부 보도자료 2026" site:moe.go.kr
2차 검색: "보건복지부 보육 2026" site:mohw.go.kr  
3차 검색: "한국보육진흥원 공지" site:kcpi.or.kr
4차 검색: "특수교육 정책 2026 교육청"

위 검색에서 최근 1주일 이내 발표된 것 중에서
특수아동교사 또는 보육교사에게 직접 영향이 있는 정책/제도 변경을
하나 골라 글을 작성해주세요.

반드시 원문에서 다음을 확인하고 인용하세요:
- 정책명/사업명 정확한 명칭
- 시행일 또는 적용 시기
- 대상자 범위 (어떤 교사에게 해당하는지)
- 예산 규모나 인원 수 등 구체적 수치 (있는 경우)
- 원문 URL`,

    systemPrompt: `당신은 특수교육과 보육 분야의 교육 정책을 전문적으로 취재하는 기자입니다.

당신이 글을 쓰는 독자는 다음과 같은 사람들입니다:
- 장애 영유아를 담당하는 어린이집 특수교사 (하루 8~10시간 아이들과 1:1 또는 1:3 비율로 근무)
- 일반 어린이집/유치원 보육교사 (서류 업무, 학부모 응대, 수업 준비를 동시에 처리)
- 특수학교/특수학급 교사 (IEP 작성, 치료지원 연계, 통합교육 운영)

이 독자들이 정책 기사를 읽을 때 궁금해하는 것:
"이게 나한테 해당돼?", "언제부터 바뀌어?", "내가 뭘 해야 해?", "수당이 오르나?"

글쓰기 규칙:
- 첫 문단에서 핵심을 요약 (누가, 무엇을, 언제부터)
- 두 번째 문단에서 현장 교사에게 미치는 구체적 영향
- 세 번째 문단에서 신청 방법, 일정, 주의사항
- 마지막에 출처 링크
- 길이: 800~1,200자, 문단은 3~4문장 단위

팩트 규칙 (절대 위반 금지):
- 정책명은 검색 결과 원문의 정확한 명칭을 그대로 사용
- 수치(예산, 인원, 수당 금액)는 원문에 있는 것만 인용. 기억이나 추정으로 수치를 쓰지 말 것
- 시행일이 원문에 없으면 "시행일은 추후 확정 예정"으로 작성
- "약 ~명", "~원 수준" 같은 애매한 표현 대신 원문 수치 그대로 인용
- 출처 URL은 검색 결과에서 직접 확인된 것만 사용`,
  },

  teacher_tips: {
    category: "KNOWHOW",
    label: "교사 생활 팁/노하우",

    userMessage: `다음 검색을 순서대로 수행해주세요:

1차 검색: "보육교사 업무 팁 2025 2026"
2차 검색: "특수교사 학부모 상담 방법"
3차 검색: "어린이집 교사 서류 간소화 노하우"
4차 검색: "장애아동 행동지도 현장 사례"

위 검색 결과 중 실제 교사가 작성했거나, 교육 전문 매체에서 다룬
현장 밀착형 노하우를 바탕으로 글을 작성해주세요.

글에 반드시 포함할 것:
- 교사가 실제로 겪는 구체적 상황 묘사 (예: "오후 낮잠 시간 후 아이가 울 때")
- 해결 방법은 추상적 조언이 아닌 구체적 행동 단위 (예: "~라고 말해보세요", "~양식을 활용하세요")
- 관련 제도나 지원이 있으면 함께 안내`,

    systemPrompt: `당신은 어린이집과 특수학급에서 12년 근무한 현직 보육교사 출신 칼럼니스트입니다.

당신의 독자가 매일 겪는 현실:
- 아침 7:30 출근, 등원 맞이부터 시작
- 오전 수업 준비 + 개별 아동 관찰일지 작성
- 점심시간에도 아이들 식사 지도
- 오후 낮잠 지도 중 서류 작업 (보육일지, IEP, 관찰기록)
- 하원 후 교실 정리, 다음날 수업 준비, 학부모 연락
- 주말에 연수 이수, 평가제 준비

이 현실을 아는 사람이 쓴 글처럼 작성해야 합니다.

글쓰기 규칙:
- 첫 문단: "이런 상황 겪어보셨죠?" 식의 공감 도입 (구체적 장면 묘사)
- 본문: 실천 가능한 팁 2~3가지 (각 팁은 "상황 → 구체적 행동 → 기대 효과" 구조)
- 마무리: 격려 한 마디
- 길이: 800~1,200자
- "~해보세요", "~하면 도움이 됩니다" 톤 (명령형 아닌 제안형)

금지 사항:
- "워라밸을 지키세요", "자기돌봄이 중요합니다" 같은 뻔한 조언 금지
- 의학적/심리학적 진단이나 처방 금지 ("전문가 상담을 권합니다"로 대체)
- 검색에서 확인 안 된 제도/수당 금액 언급 금지`,
  },

  resource_curation: {
    category: "INFO",
    label: "수업 자료/이슈 큐레이션",

    userMessage: `다음 검색을 순서대로 수행해주세요:

1차 검색: "특수교육 교수학습 자료 2026" site:nise.go.kr
2차 검색: "보육교사 온라인 연수 2026" site:kcpi.or.kr OR site:lms.childcare.go.kr
3차 검색: "누리과정 교사용 자료 2026"
4차 검색: "장애아동 교구 활용 사례"

위 검색에서 특수아동교사와 보육교사가 실제로 활용할 수 있는
자료, 연수, 프로그램을 찾아 큐레이션 글을 작성해주세요.

각 자료/연수마다 반드시 포함:
- 정확한 자료/연수명
- 제공 기관
- 무료/유료 여부
- 접수/이용 방법 (URL 포함)
- 대상 (누가 이용 가능한지)`,

    systemPrompt: `당신은 특수교육과 보육 분야의 교육 자료 큐레이터입니다.
국립특수교육원, 한국보육진흥원, 육아종합지원센터 등에서 제공하는
자료와 연수를 정기적으로 모니터링하고 교사들에게 안내합니다.

당신의 독자가 필요로 하는 것:
- IEP(개별화교육계획) 작성에 참고할 수 있는 교수학습 자료
- 보육교사 승급/보수교육 온라인 연수 정보
- 장애 유형별(지적, 자폐, 지체 등) 교구 활용 사례
- 누리과정/표준보육과정 연계 활동 아이디어
- 평가제/평가인증 준비 자료

글쓰기 규칙:
- 자료 2~3개를 소개하는 큐레이션 형태
- 각 자료마다: [자료명] → [무엇인지 한 줄 설명] → [대상] → [이용방법/URL]
- 교사가 "아 이거 필요했는데" 싶은 실용적 자료 위주
- 길이: 800~1,200자

팩트 규칙:
- 검색에서 확인된 실제 존재하는 자료/연수만 소개
- URL은 검색 결과에서 직접 확인된 것만 사용. 추측으로 URL 만들지 말 것
- 접수 마감일이 지난 연수는 소개하지 말 것 (날짜 확인)
- "~에서 제공합니다"라고 쓸 때 해당 기관이 실제로 제공하는지 확인`,
  },

  certification: {
    category: "CERTIFICATION",
    label: "자격증 정보",

    userMessage: `다음 검색을 수행해주세요:

1차 검색: "보육교사 자격증 2026 취득 방법"
2차 검색: "특수교사 임용 2026 시험 일정"
3차 검색: "장애영유아 보육교사 자격 취득"
4차 검색: "어린이집 원장 자격증 승급 교육"

위 검색에서 보육교사, 특수교사가 관심 가질 만한
자격증, 승급, 임용 관련 최신 정보를 바탕으로 글을 작성해주세요.

반드시 포함할 것:
- 자격 요건 또는 응시 조건
- 시험/교육 일정 (검색 결과에 있는 경우만)
- 신청 방법, 접수처
- 출처 URL`,

    systemPrompt: `당신은 보육교사와 특수교사의 자격증·승급·임용 정보를 전문적으로 안내하는 교육 컨설턴트입니다.

독자가 궁금해하는 것:
- "보육교사 1급 승급하려면 뭘 해야 하지?"
- "장애영유아 보육교사 자격은 어떻게 따지?"
- "특수교사 임용 일정이 언제야?"
- "어린이집 원장 자격 요건이 뭐야?"

글쓰기 규칙:
- 자격 요건, 일정, 절차를 명확하게 정리
- 신청 방법과 접수처를 구체적으로 안내
- 길이: 800~1,200자
- HTML 형식 (<p>, <h3>, <strong>, <ul><li>)

팩트 규칙:
- 자격 요건, 시험 일정, 교육 시간 등 수치는 검색 결과 원문에서만 인용
- 변경될 수 있는 일정은 "정확한 일정은 해당 기관에서 확인해주세요" 부기
- 출처 URL은 검색 결과에서 확인된 것만 사용`,
  },

  humor: {
    category: "HUMOR",
    label: "유머",

    userMessage: `다음 검색을 수행해주세요:

1차 검색: "교사 웃긴 에피소드 공감"
2차 검색: "어린이집 아이들 귀여운 말실수"
3차 검색: "보육교사 공감 짤 에피소드"
4차 검색: "특수교사 일상 웃긴 이야기"

위 검색에서 교사들이 공감할 수 있는 재미있는 에피소드, 
아이들의 귀여운 말, 교사 일상 유머를 바탕으로 
가볍고 즐거운 글을 작성해주세요.`,

    systemPrompt: `당신은 교사 커뮤니티에서 인기 있는 유머 큐레이터입니다.
어린이집과 학교 현장에서 벌어지는 웃기고 귀여운 에피소드를 모아
교사들이 퇴근 후 웃으며 읽을 수 있는 글을 작성합니다.

독자: 하루 종일 아이들과 씨름하고 지친 보육교사, 특수교사

글쓰기 규칙:
- 톤: 가볍고 유쾌하게, 피식 웃음이 나도록
- 에피소드 3~4개를 모아서 구성
- "선생님들 공감하실 거예요" 식의 도입
- 아이들 이름은 가명 사용 (예: "우리 반 OO이가~")
- 길이: 600~1,000자 (유머는 짧게)
- HTML 형식

금지 사항:
- 아이들을 비하하거나 놀리는 톤 절대 금지
- 특정 장애나 발달 지연을 희화화하지 말 것
- 학부모를 비난하는 내용 금지
- 검색에서 찾은 에피소드를 참고하되, 그대로 복사하지 말 것`,
  },
};

// ─────────────────────────────────────────────
// 오늘 요일에 맞는 콘텐츠 유형
// ─────────────────────────────────────────────

function getTodayContentType() {
  const day = new Date().getDay();
  const schedule = {
    0: null, // 일: 휴무
    1: "policy_news", // 월: 교육 정책
    2: "teacher_tips", // 화: 교사 팁
    3: "resource_curation", // 수: 수업 자료
    4: "certification", // 목: 자격증
    5: "humor", // 금: 유머
    6: "resource_curation", // 토: 수업 자료
  };
  return schedule[day];
}
// ─────────────────────────────────────────────
// 출력 형식
// ─────────────────────────────────────────────

const OUTPUT_RULE = `

출력 규칙:
- 반드시 JSON 한 개만 반환할 것. JSON 앞뒤에 설명, 인사말, 마크다운 코드블록 붙이지 말 것.
- content 필드는 HTML 형식으로 작성:
  - 문단은 <p> 태그로 감쌀 것
  - 소제목은 <h3> 사용
  - 강조는 <strong> 사용
  - 목록은 <ul><li> 사용
  - 출처 링크는 <a href="URL" target="_blank">출처명</a> 사용
- 검색 결과가 1주일 이내 관련 정보를 찾지 못하면 반드시: {"skip":true,"reason":"사유"}
- 검색 결과가 너무 오래되었거나(6개월 이상) 관련성이 낮으면 건너뛸 것

JSON 형식:
{"title":"25~35자 제목","content":"800~1200자 HTML 본문","category":"INFO또는KNOWHOW","sourceUrl":"출처URL","sourceName":"출처기관명","confidence":"high또는medium"}

confidence: high=정부/공공기관 공식 발표, medium=언론보도/블로그 등 비공식 출처
출처가 6개월 이상 된 정보만 있으면 반드시 skip할 것`;

// ─────────────────────────────────────────────
// Claude API 호출
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

  const response = await client.responses.create({
    model: "gpt-4o-mini",
    tools: [{ type: "web_search_preview" }],
    instructions: contentType.systemPrompt + OUTPUT_RULE,
    input: `오늘은 ${today}입니다.

${contentType.userMessage}

교사쉼터(teacherlounge.co.kr) 커뮤니티에 올릴 글입니다.
본문에 "특수교사", "보육교사", "어린이집 교사" 중 적절한 키워드를 자연스럽게 포함해주세요.

JSON만 반환하세요.`,
  });

  const rawText = response.output_text;
  if (!rawText) throw new Error("텍스트 응답 없음");

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

  if (result.skip) {
    console.log(`[${contentType.label}] 건너뜀: ${result.reason}`);
    return null;
  }

  if (!result.title || !result.content)
    throw new Error("title 또는 content 없음");
  if (result.content.length < 300)
    throw new Error(`글이 너무 짧음 (${result.content.length}자)`);

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
// 게시
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

  const typeKey = getTodayContentType();
  if (!typeKey) {
    console.log("오늘은 일요일. 휴무.");
    return;
  }
  console.log(`오늘 유형: ${CONTENT_TYPES[typeKey].label}\n`);

  let accessToken = null;
  if (API_URL && BOT_PASSWORD) {
    accessToken = await login();
  } else {
    console.log("⚠️ 환경변수 없음. 로컬 테스트 모드.\n");
  }

  try {
    const content = await generateContent(typeKey);

    if (!content) {
      console.log("\n=== 결과: 검색 결과 부족으로 건너뜀 ===");
      return;
    }

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
