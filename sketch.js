/*
  Thumbs Mood Reader
  p5.js + ml5.js (handPose)
  Thumbs up       -> "I'm glad you're feeling great!"
  Thumbs sideways -> "Well, at least you're not thumbs down."
  Thumbs down     -> plays the YouTube video
  Hold a gesture for about 1 second to lock it in.
*/

let video;        // webcam
let handPose;     // ml5 hand model
let hands = [];   // hands found this frame

// cover-fit values: webcam fills the canvas without stretching
let coverScale, videoDrawW, videoDrawH, videoOffsetX, videoOffsetY;

// ---- gesture settings ----
const HOLD_FRAMES = 40;   // how long to hold a gesture (about 1 second at 60fps)
const YOUTUBE_ID = "NSUjXhWuGSc";
const YOUTUBE_URL = "https://www.youtube.com/watch?v=" + YOUTUBE_ID;

let mode = "detect";      // "detect", "up", "side", "down"
let currentGesture = "none";
let holdCount = 0;

// on-screen elements for the result screens
let againButton, ytFrame, ytLink;

function preload() {
  // one hand is enough; flipped so it acts like a mirror
  handPose = ml5.handPose({ maxHands: 1, flipped: true });
}

// real pixel size of the webcam (differs on phones)
function getSourceSize() {
  const vw =
    (video && video.elt && video.elt.videoWidth) || (video && video.width) || 640;
  const vh =
    (video && video.elt && video.elt.videoHeight) || (video && video.height) || 480;
  return { vw: max(1, vw), vh: max(1, vh) };
}

function updateVideoCoverTransform() {
  const { vw, vh } = getSourceSize();
  coverScale = max(width / vw, height / vh);
  videoDrawW = vw * coverScale;
  videoDrawH = vh * coverScale;
  videoOffsetX = (width - videoDrawW) / 2;
  videoOffsetY = (height - videoDrawH) / 2;
}

// ml5 coordinates (video space) -> canvas coordinates
function videoToCanvas(vx, vy) {
  return { x: videoOffsetX + vx * coverScale, y: videoOffsetY + vy * coverScale };
}

// iOS Safari needs playsinline or the camera can freeze
function prepareVideoElement(capture) {
  const elt = capture.elt;
  elt.setAttribute("playsinline", "");
  elt.setAttribute("webkit-playsinline", "");
  elt.muted = true;
  elt.autoplay = true;
  const p = elt.play && elt.play();
  if (p && typeof p.catch === "function") p.catch(() => {});
}

async function setup() {
  createCanvas(windowWidth, windowHeight);
  textAlign(CENTER, CENTER);

  // WebGL backend is more reliable than WebGPU on iOS
  if (typeof ml5.setBackend === "function") {
    try {
      await ml5.setBackend("webgl");
    } catch (e) {}
  }

  video = createCapture(
    { audio: false, video: { facingMode: "user" } },
    () => {
      prepareVideoElement(video);
      updateVideoCoverTransform();
    }
  );
  prepareVideoElement(video);
  video.hide();
  updateVideoCoverTransform();

  handPose.detectStart(video, gotHands);

  // "Try again" button, hidden until a result screen shows
  againButton = createButton("Try again");
  againButton.style("font-size", "20px");
  againButton.style("padding", "10px 24px");
  againButton.style("border-radius", "999px");
  againButton.style("border", "none");
  againButton.style("cursor", "pointer");
  againButton.mousePressed(resetToDetect);
  againButton.hide();
}

function gotHands(results) {
  hands = results;
}

// ------------------------------------------------------------
//  Gesture classification
// ------------------------------------------------------------

function kp(hand, name) {
  return hand.keypoints.find((k) => k.name === name);
}

// returns "up", "side", "down" or "none"
function classifyThumb(hand) {
  const wrist = kp(hand, "wrist");
  const thumbTip = kp(hand, "thumb_tip");
  const thumbMcp = kp(hand, "thumb_mcp");
  const indexMcp = kp(hand, "index_finger_mcp");
  const middleMcp = kp(hand, "middle_finger_mcp");
  if (!wrist || !thumbTip || !thumbMcp || !indexMcp || !middleMcp) return "none";

  // hand size, so the thresholds work near or far from the camera
  const handSize = dist(wrist.x, wrist.y, middleMcp.x, middleMcp.y);
  if (handSize < 10) return "none";

  // 1) the other four fingers should be curled into a fist:
  //    a curled fingertip sits closer to the wrist than its middle knuckle
  const fingers = ["index_finger", "middle_finger", "ring_finger", "pinky_finger"];
  let curled = 0;
  for (const f of fingers) {
    const tip = kp(hand, f + "_tip");
    const pip = kp(hand, f + "_pip");
    if (!tip || !pip) continue;
    if (dist(tip.x, tip.y, wrist.x, wrist.y) < dist(pip.x, pip.y, wrist.x, wrist.y) * 1.1) {
      curled++;
    }
  }
  if (curled < 3) return "none";

  // 2) the thumb should stick out from the fist
  const thumbOut = dist(thumbTip.x, thumbTip.y, indexMcp.x, indexMcp.y);
  if (thumbOut < handSize * 0.55) return "none";

  // 3) which way does the thumb point? (y goes DOWN on screen, so flip it)
  const dx = thumbTip.x - thumbMcp.x;
  const dy = -(thumbTip.y - thumbMcp.y);
  const angle = degrees(atan2(dy, dx)); // 90 = up, -90 = down, 0/180 = sideways

  if (angle > 50 && angle < 130) return "up";
  if (angle < -50 && angle > -130) return "down";
  if (abs(angle) < 35 || abs(angle) > 145) return "side";
  return "none"; // in between: not sure yet
}

// ------------------------------------------------------------
//  Drawing
// ------------------------------------------------------------

function draw() {
  if (mode === "detect") {
    drawDetectScreen();
  } else if (mode === "up") {
    drawMessageScreen("I'm glad you're feeling great!", "👍", color(255, 214, 90), color(255, 140, 60));
  } else if (mode === "side") {
    drawMessageScreen("Well, at least you're not thumbs down.", "👉", color(120, 200, 230), color(70, 110, 200));
  } else if (mode === "down") {
    background(15);
  }
}

function drawDetectScreen() {
  updateVideoCoverTransform();
  background(0);

  // mirrored webcam
  push();
  translate(width, 0);
  scale(-1, 1);
  image(video, videoOffsetX, videoOffsetY, videoDrawW, videoDrawH);
  pop();

  // read the gesture
  let gesture = "none";
  if (hands.length > 0) {
    gesture = classifyThumb(hands[0]);
    drawHandDots(hands[0]);
  }

  // hold-to-confirm: the same gesture must stay for HOLD_FRAMES frames
  if (gesture !== "none" && gesture === currentGesture) {
    holdCount++;
  } else {
    currentGesture = gesture;
    holdCount = 0;
  }

  // instructions bar
  noStroke();
  fill(0, 160);
  rect(0, 0, width, 90);
  fill(255);
  textSize(min(28, width / 20));
  text("How are you feeling? Show me a thumb 👍 👉 👎", width / 2, 45);

  // progress ring while holding
  if (currentGesture !== "none") {
    const labels = { up: "Thumbs up", side: "Thumbs sideways", down: "Thumbs down" };
    const p = holdCount / HOLD_FRAMES;
    const cx = width / 2;
    const cy = height - 110;
    noFill();
    stroke(255, 80);
    strokeWeight(10);
    circle(cx, cy, 120);
    stroke(255);
    arc(cx, cy, 120, 120, -HALF_PI, -HALF_PI + TWO_PI * p);
    noStroke();
    fill(255);
    textSize(20);
    text(labels[currentGesture], cx, cy);

    if (holdCount >= HOLD_FRAMES) showResult(currentGesture);
  } else if (hands.length === 0) {
    noStroke();
    fill(255, 200);
    textSize(18);
    text("No hand detected", width / 2, height - 60);
  }
}

function drawHandDots(hand) {
  noStroke();
  for (const k of hand.keypoints) {
    const p = videoToCanvas(k.x, k.y);
    fill(k.name === "thumb_tip" ? color(255, 220, 0) : color(255, 255, 255, 180));
    circle(p.x, p.y, k.name === "thumb_tip" ? 18 : 8);
  }
}

function drawMessageScreen(msg, emoji, c1, c2) {
  // soft vertical gradient
  for (let y = 0; y < height; y += 4) {
    stroke(lerpColor(c1, c2, y / height));
    strokeWeight(4);
    line(0, y, width, y);
  }
  noStroke();
  fill(255);
  const bob = sin(frameCount * 0.05) * 10;
  textSize(min(140, width / 5));
  text(emoji, width / 2, height / 2 - 110 + bob);
  textSize(min(48, width / 16));
  textWrap(WORD);
  text(msg, width * 0.1, height / 2 - 40, width * 0.8, 160);
}

// ------------------------------------------------------------
//  Switching screens
// ------------------------------------------------------------

function showResult(gesture) {
  mode = gesture;
  holdCount = 0;
  currentGesture = "none";

  againButton.show();
  againButton.position(width / 2 - 70, height - 90);

  if (gesture === "down") {
    // Most browsers block opening a new tab without a click, so the video plays
    // right here, with a link to open it on YouTube as a backup.
    const vw = min(width * 0.85, 960);
    const vh = vw * 9 / 16;
    ytFrame = createElement("iframe");
    ytFrame.attribute("src", "https://www.youtube.com/embed/" + YOUTUBE_ID + "?autoplay=1");
    ytFrame.attribute("allow", "autoplay; encrypted-media; fullscreen");
    ytFrame.attribute("allowfullscreen", "");
    ytFrame.attribute("frameborder", "0");
    ytFrame.size(vw, vh);
    ytFrame.position((width - vw) / 2, max(20, (height - vh) / 2 - 50));

    ytLink = createA(YOUTUBE_URL, "Video not playing? Open it on YouTube", "_blank");
    ytLink.style("color", "#fff");
    ytLink.style("font-size", "18px");
    ytLink.position(width / 2 - 150, height - 140);
  }
}

function resetToDetect() {
  mode = "detect";
  holdCount = 0;
  currentGesture = "none";
  againButton.hide();
  if (ytFrame) { ytFrame.remove(); ytFrame = null; }
  if (ytLink) { ytLink.remove(); ytLink = null; }
}

// keyboard shortcut: press any key to go back
function keyPressed() {
  if (mode !== "detect") resetToDetect();
}

function touchStarted() {
  // some iPhones need one tap before the camera starts
  if (video && video.elt && video.elt.paused) prepareVideoElement(video);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  updateVideoCoverTransform();
  if (mode !== "detect") againButton.position(width / 2 - 70, height - 90);
}
