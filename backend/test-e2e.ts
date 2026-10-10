const BASE_URL = "http://localhost:5000";

let testCount = 0;
let passedCount = 0;

function assert(condition: boolean, testName: string, details?: any) {
  testCount++;
  if (condition) {
    passedCount++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    console.error(`  ✗ FAIL: ${testName}`, details ?? "");
  }
}

async function runTests() {
  console.log("\n========================================================");
  console.log("  StudyPact Backend & Database Integration Verification");
  console.log("========================================================\n");

  // Generate a distinct Indian phone number for isolated lifecycle testing
  const randomSuffix = Math.floor(10000000 + Math.random() * 90000000).toString();
  const phone = `98${randomSuffix.slice(0, 8)}`;
  const scholarName = `Dr. Scholar ${phone.slice(-4)}`;

  let token = "";
  let userId = "";
  let createdGoalId = "";
  let createdRoomId = "";
  let createdRoomCode = "";
  let createdDoubtId = "";

  // 1. Authentication: Request OTP (Sign Up flow)
  console.log(`[Test Suite 1: Authentication for ${scholarName}]`);
  const otpRes = await fetch(`${BASE_URL}/api/auth/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, fullName: scholarName, mode: "signup" }),
  }).then((r) => r.json());

  assert(otpRes.success === true && Boolean(otpRes.otp), "Request signup OTP succeeds with valid dev OTP");
  const otp = otpRes.otp;

  // 2. Authentication: Verify OTP & Establish Session
  const loginRes = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, token: otp, fullName: scholarName }),
  }).then((r) => r.json());

  assert(loginRes.success === true && Boolean(loginRes.session?.access_token), "Verify OTP returns session with access token");
  token = loginRes.session.access_token;
  userId = loginRes.user.id;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  // 3. User Profile
  const meRes = await fetch(`${BASE_URL}/api/auth/me`, { headers }).then((r) => r.json());
  assert(meRes.success === true && meRes.user.id === userId, `Profile verified for user: ${meRes.user?.full_name || meRes.user?.id}`);

  // 4. Cohorts: List Rooms
  console.log("\n[Test Suite 2: Cohorts / Rooms]");
  const roomsRes = await fetch(`${BASE_URL}/api/rooms`).then((r) => r.json());
  assert(roomsRes.success === true && Array.isArray(roomsRes.data) && roomsRes.data.length > 0, `GET /api/rooms fetches cohorts from database (${roomsRes.data?.length} rooms)`);

  // 5. Daily Pact Targets: Create Goal
  console.log("\n[Test Suite 3: Daily Pact Goals & Streaks]");
  const uniqueGoalText = `Study Session ${Date.now()}: Ethics & Constitution`;
  const createGoalRes = await fetch(`${BASE_URL}/api/daily-goals`, {
    method: "POST",
    headers,
    body: JSON.stringify({ description: uniqueGoalText }),
  }).then((r) => r.json());

  assert(createGoalRes.success === true && createGoalRes.data.description === uniqueGoalText, "POST /api/daily-goals persists goal in database");
  createdGoalId = createGoalRes.data.id;
  assert(createGoalRes.data.userId === userId, "Goal is properly associated with authenticated user ID");

  // 6. Daily Goals: Get Today's Goals
  const todayGoalsRes = await fetch(`${BASE_URL}/api/daily-goals/today`, { headers }).then((r) => r.json());
  const foundGoal = (todayGoalsRes.data || []).find((g: any) => g.id === createdGoalId);
  assert(Boolean(foundGoal), "GET /api/daily-goals/today retrieves the created goal for the user");

  // 7. Daily Goals: Update Goal
  const updatedGoalText = `${uniqueGoalText} (Updated)`;
  const patchGoalRes = await fetch(`${BASE_URL}/api/daily-goals/${createdGoalId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ description: updatedGoalText }),
  }).then((r) => r.json());
  assert(patchGoalRes.success === true && patchGoalRes.data.description === updatedGoalText, "PATCH /api/daily-goals/:id updates goal description");

  // 8. Daily Goals: Complete Goal & Calculate Streak
  const completeGoalRes = await fetch(`${BASE_URL}/api/daily-goals/${createdGoalId}/complete`, {
    method: "POST",
    headers,
  }).then((r) => r.json());
  assert(completeGoalRes.success === true && completeGoalRes.data.isCompleted === true, "POST /api/daily-goals/:id/complete marks goal as completed");

  const streakRes = await fetch(`${BASE_URL}/api/daily-goals/streak`, { headers }).then((r) => r.json());
  assert(streakRes.success === true && streakRes.data.streak === 1, `GET /api/daily-goals/streak increments streak to 1 after completion (streak: ${streakRes.data?.streak})`);

  // 9. Daily Goals: Reset Streak
  const resetRes = await fetch(`${BASE_URL}/api/daily-goals/streak/reset`, {
    method: "POST",
    headers,
  }).then((r) => r.json());
  assert(resetRes.success === true && resetRes.data.streak === 0, "POST /api/daily-goals/streak/reset resets streak to 0");

  const streakAfterReset = await fetch(`${BASE_URL}/api/daily-goals/streak`, { headers }).then((r) => r.json());
  assert(streakAfterReset.data.streak === 0, "GET /api/daily-goals/streak confirms reset streak is 0");

  // 10. Global Leaderboard
  console.log("\n[Test Suite 4: Leaderboard]");
  const leaderboardRes = await fetch(`${BASE_URL}/api/daily-goals/leaderboard`, { headers }).then((r) => r.json());
  assert(leaderboardRes.success === true && Array.isArray(leaderboardRes.data), "GET /api/daily-goals/leaderboard returns real database rankings");
  assert(leaderboardRes.data.length > 0 && Boolean(leaderboardRes.data[0].name), `Leaderboard displays member name: "${leaderboardRes.data[0]?.name}"`);

  // 11. Create a Cohort
  console.log("\n[Test Suite 5: Cohort Operations & Membership]");
  const newRoomName = `Sprint Cohort ${Date.now().toString().slice(-4)}`;
  const createRoomRes = await fetch(`${BASE_URL}/api/rooms`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: newRoomName,
      examCategory: "UPSC",
      description: "Automated verification room",
    }),
  }).then((r) => r.json());

  assert(createRoomRes.success === true && Boolean(createRoomRes.data?.id), `POST /api/rooms creates new cohort "${newRoomName}"`);
  createdRoomId = createRoomRes.data.id;
  createdRoomCode = createRoomRes.data.roomCode;
  assert(Boolean(createdRoomCode) && createdRoomCode.length === 6, `Room code generated: ${createdRoomCode}`);

  // 12. Validate Cohort Code
  const codeRes = await fetch(`${BASE_URL}/api/rooms/code/${createdRoomCode}`).then((r) => r.json());
  assert(codeRes.success === true && codeRes.data.id === createdRoomId, "GET /api/rooms/code/:code successfully resolves cohort by join code");

  // 13. Cohort Membership & Details
  const membersRes = await fetch(`${BASE_URL}/api/rooms/${createdRoomId}/members`, { headers }).then((r) => r.json());
  assert(membersRes.success === true && membersRes.data.some((m: any) => m.userId === userId), "Creator automatically registered in room_members");

  const roomLeaderboardRes = await fetch(`${BASE_URL}/api/rooms/${createdRoomId}/leaderboard`, { headers }).then((r) => r.json());
  assert(roomLeaderboardRes.success === true && Array.isArray(roomLeaderboardRes.data), "GET /api/rooms/:id/leaderboard calculates room standings without errors");

  const roomGoalsRes = await fetch(`${BASE_URL}/api/rooms/${createdRoomId}/daily-goals`, { headers }).then((r) => r.json());
  assert(roomGoalsRes.success === true && Array.isArray(roomGoalsRes.data), "GET /api/rooms/:id/daily-goals fetches member daily goals for cohort");

  // 14. Doubt Forum
  console.log("\n[Test Suite 6: Doubt Forum & Accountability]");
  const doubtContent = `Question regarding ethical principles in governance at ${Date.now()}`;
  const postDoubtRes = await fetch(`${BASE_URL}/api/rooms/${createdRoomId}/doubts`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content: doubtContent }),
  }).then((r) => r.json());

  assert(postDoubtRes.success === true && postDoubtRes.data.content === doubtContent, "POST /api/rooms/:id/doubts persists doubt in database");
  createdDoubtId = postDoubtRes.data.id;

  const replyContent = "Apply Nolan Principles: integrity, objectivity, accountability.";
  const postReplyRes = await fetch(`${BASE_URL}/api/rooms/${createdRoomId}/doubts/${createdDoubtId}/replies`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content: replyContent }),
  }).then((r) => r.json());

  assert(postReplyRes.success === true && postReplyRes.data.content === replyContent, "POST /api/rooms/:id/doubts/:doubtId/replies posts reply");

  const doubtsListRes = await fetch(`${BASE_URL}/api/rooms/${createdRoomId}/doubts`, { headers }).then((r) => r.json());
  const foundDoubt = (doubtsListRes.data || []).find((d: any) => d.id === createdDoubtId);
  assert(Boolean(foundDoubt && foundDoubt.replies?.length > 0), "GET /api/rooms/:id/doubts returns doubt with author and replies");

  // 15. Mock Exam Integration
  console.log("\n[Test Suite 7: Mock Exam Integration]");
  const mockPapersRes = await fetch(`${BASE_URL}/api/mock-exams/papers`, { headers }).then((r) => r.json());
  assert(mockPapersRes.success === true && Array.isArray(mockPapersRes.data) && mockPapersRes.data.length > 0, `GET /api/mock-exams/papers returns real papers (${mockPapersRes.data?.length} available)`);

  const mockSessionsRes = await fetch(`${BASE_URL}/api/mock/rooms/${createdRoomId}/sessions`, { headers }).then((r) => r.json());
  assert(mockSessionsRes.success === true && Array.isArray(mockSessionsRes.data), "GET /api/mock/rooms/:id/sessions returns cohort mock sessions");

  // 16. Leave Room
  console.log("\n[Test Suite 8: Membership Lifecycle]");
  const leaveRes = await fetch(`${BASE_URL}/api/rooms/${createdRoomId}/membership`, {
    method: "DELETE",
    headers,
  });
  assert(leaveRes.status === 204, "DELETE /api/rooms/:id/membership cleanly removes member");

  console.log("\n========================================================");
  console.log(`  Summary: ${passedCount} / ${testCount} Tests Passed!`);
  console.log("========================================================\n");

  if (passedCount === testCount) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("FATAL TEST RUN ERROR:", err);
  process.exit(1);
});
