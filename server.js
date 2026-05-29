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
  const stitchedVideoPath = path.join(tempDir, "stitched.mp4");
  const finalVideoPath = path.join(tempDir, "final.mp4");

  try {
    // 1. Download audio from Drive
    await new Promise((resolve, reject) => {
      drive.files.get(
        { fileId: audioDriveFileId, alt: "media" },
        { responseType: "stream" },
        (err, driveRes) => {
          if (err) return reject(err);
          const dest = fs.createWriteStream(audioPath);
          driveRes.data
            .on("error", reject)
            .pipe(dest)
            .on("finish", resolve)
            .on("error", reject);
        }
      );
    });

    // 2. Download Pexels clips
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
      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      downloadedClips.push(clipPath);
    }

    if (downloadedClips.length === 0) {
      return res.status(500).json({
        youtubeUploadStatus: "error",
        message: "No Pexels clips downloaded"
      });
    }

    // 3. Build filter_complex for smooth crossfades
    const fadeDuration = 1.0;
    let ff = ffmpeg();
    downloadedClips.forEach(c => ff = ff.input(c));

    let filterComplex = "";
    let lastLabel = "v0";

    for (let i = 0; i < downloadedClips.length; i++) {
      if (i === 0) {
        filterComplex += `[0:v]format=yuv420p[v0];`;
      } else {
        filterComplex += `[${i}:v]format=yuv420p[v${i}];`;
        filterComplex += `[${lastLabel}][v${i}]xfade=transition=fade:duration=${fadeDuration}:offset=${i * 3}[v${i + 1}];`;
        lastLabel = `v${i + 1}`;
      }
    }

    await new Promise((resolve, reject) => {
      ff
        .complexFilter(filterComplex)
        .outputOptions(["-map", `[${lastLabel}]`, "-c:v", "libx264", "-pix_fmt", "yuv420p"])
        .save(stitchedVideoPath)
        .on("end", resolve)
        .on("error", reject);
    });

    // 4. Overlay audio on stitched video
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

    console.log("Final cinematic video created:", finalVideoPath);

    // 5. (Placeholder) YouTube upload
    // TODO: integrate real YouTube upload here.
    const youtubeUploadStatus = "success";
    const youtubeVideoId = "SIMULATED123";

    return res.status(200).json({
      youtubeUploadStatus,
      youtubeVideoId
    });
  } catch (error) {
    console.error("Error processing video:", error);
    return res.status(500).json({
      youtubeUploadStatus: "error",
      message: error.message || "Processing failed"
    });
  } finally {
    try {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        if (
          file.startsWith("clip_") ||
          file.includes("stitched") ||
          file.includes("voiceover") ||
          file.includes("final")
        ) {
          try {
            fs.unlinkSync(path.join(tempDir, file));
          } catch {}
        }
      }
    } catch {}
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Cloud Run video factory ready on port ${port}`));
