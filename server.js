const express = require("express");
const ffmpeg = require("fluent-ffmpeg");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

// Google Drive Auth (Service Account)
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ["https://www.googleapis.com/auth/drive"],
});
const drive = google.drive({ version: "v3", auth });

app.post("/process", async (req, res) => {
  const providedSecret = req.headers["x-api-secret"];
  if (providedSecret !== process.env.API_SECRET) {
    return res.status(401).send("Unauthorized");
  }

  const { title, audioDriveFileId, pexelsVideos } = req.body;

  const tempDir = "/tmp";
  const audioPath = path.join(tempDir, "voiceover.mp3");
  const finalVideoPath = path.join(tempDir, "final.mp4");

  try {
    // Acknowledge immediately
    res.status(202).send({ status: "Processing started" });

    // ------------------------------------------------------------
    // 1. Download MP3 from Google Drive
    // ------------------------------------------------------------
    const audioDest = fs.createWriteStream(audioPath);
    await drive.files.get(
      { fileId: audioDriveFileId, alt: "media" },
      { responseType: "stream" },
      (err, driveRes) => {
        if (err) throw err;
        driveRes.data.pipe(audioDest);
      }
    );
    await new Promise((resolve) => audioDest.on("finish", resolve));

    // ------------------------------------------------------------
    // 2. Download all Pexels videos
    // ------------------------------------------------------------
    const downloadedClips = [];

    for (let i = 0; i < pexelsVideos.length; i++) {
      const url = pexelsVideos[i];
      const clipPath = path.join(tempDir, `clip_${i}.mp4`);
      const writer = fs.createWriteStream(clipPath);

      const response = await axios({
        url,
        method: "GET",
        responseType: "stream",
      });

      response.data.pipe(writer);
      await new Promise((resolve) => writer.on("finish", resolve));

      downloadedClips.push(clipPath);
    }

    // ------------------------------------------------------------
    // 3. Create FFmpeg concat list with crossfades
    // ------------------------------------------------------------
    const concatListPath = path.join(tempDir, "concat.txt");
    const fadeDuration = 1.0; // seconds

    // Build filter_complex for crossfades
    let filterComplex = "";
    let inputArgs = "";
    let lastOutput = "[v0]";

    downloadedClips.forEach((clip, index) => {
      inputArgs += `-i ${clip} `;
    });

    // Build crossfade chain
    for (let i = 0; i < downloadedClips.length; i++) {
      if (i === 0) {
        filterComplex += `[0:v]format=yuv420p[v0];`;
      } else {
        filterComplex += `[${i}:v]format=yuv420p[v${i}];`;
        filterComplex += `${lastOutput}[v${i}]xfade=transition=fade:duration=${fadeDuration}:offset=${i * 3}[v${i + 1}];`;
        lastOutput = `[v${i + 1}]`;
      }
    }

    // ------------------------------------------------------------
    // 4. Run FFmpeg to create cinematic montage
    // ------------------------------------------------------------
    const stitchedVideoPath = path.join(tempDir, "stitched.mp4");

    await new Promise((resolve, reject) => {
      ffmpeg()
        .inputOptions(inputArgs.trim().split(" "))
        .complexFilter(filterComplex)
        .outputOptions(["-map", `${lastOutput.replace(/

\[|\]

/g, "")}`])
        .save(stitchedVideoPath)
        .on("end", resolve)
        .on("error", reject);
    });

    // ------------------------------------------------------------
    // 5. Overlay audio on stitched video
    // ------------------------------------------------------------
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(stitchedVideoPath)
        .input(audioPath)
        .outputOptions([
          "-c:v libx264",
          "-c:a aac",
          "-shortest",
          "-pix_fmt yuv420p",
        ])
        .save(finalVideoPath)
        .on("end", resolve)
        .on("error", reject);
    });

    console.log("🎬 Final cinematic video created:", finalVideoPath);

    // ------------------------------------------------------------
    // 6. (Optional) Upload to YouTube
    // ------------------------------------------------------------
    // TODO: Add your YouTube upload logic here.
    // For now, we simulate success:
    const youtubeUploadStatus = "success";
    const youtubeVideoId = "SIMULATED123";

    // ------------------------------------------------------------
    // 7. Return status to Pipedream
    // ------------------------------------------------------------
    console.log("🎉 Video processing complete:", title);

    return {
      youtubeUploadStatus,
      youtubeVideoId,
    };
  } catch (error) {
    console.error("❌ Error processing video:", error);
  } finally {
    // ------------------------------------------------------------
    // 8. Cleanup
    // ------------------------------------------------------------
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      if (file.includes("clip_") || file.includes("stitched") || file.includes("voiceover") || file.includes("final")) {
        try {
          fs.unlinkSync(path.join(tempDir, file));
        } catch {}
      }
    }
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`🎥 Cloud Run video factory ready on port ${port}`));
