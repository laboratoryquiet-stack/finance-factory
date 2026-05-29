const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const textToSpeech = require('@google-cloud/text-to-speech');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const client = new textToSpeech.TextToSpeechClient();

app.post('/process', async (req, res) => {
    // 1. Security Check
    const providedSecret = req.headers['x-api-secret'];
    if (providedSecret !== process.env.API_SECRET) {
        return res.status(401).send("Unauthorized");
    }

    const { videoUrl, script, title } = req.body;
    const tempDir = '/tmp';
    const videoPath = path.join(tempDir, 'input.mp4');
    const audioPath = path.join(tempDir, 'speech.mp3');
    const outputPath = path.join(tempDir, 'final.mp4');

    try {
        // Acknowledge receipt
        res.status(202).send({ status: "Processing started" });

        // 2. Download Video
        const response = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
        const writer = fs.createWriteStream(videoPath);
        response.data.pipe(writer);
        await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

        // 3. Generate Audio
        const [ttsResponse] = await client.synthesizeSpeech({
            input: { text: script },
            voice: { languageCode: 'en-US', ssmlGender: 'NEUTRAL' },
            audioConfig: { audioEncoding: 'MP3' },
        });
        fs.writeFileSync(audioPath, ttsResponse.audioContent, 'binary');

        // 4. Stitching with FFmpeg
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(videoPath)
                .input(audioPath)
                .outputOptions(['-c:v copy', '-map 0:v:0', '-map 1:a:0', '-shortest'])
                .save(outputPath)
                .on('end', resolve)
                .on('error', reject);
        });

        console.log("Video processing complete:", title);

        // NOTE: Here you would add code to upload outputPath to GCS or YouTube.
        // For now, we are done.

    } catch (error) {
        console.error("Error processing video:", error);
    } finally {
        // Cleanup files to keep the server clean and free
        [videoPath, audioPath, outputPath].forEach(file => {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        });
    }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Factory ready on port ${port}`));
