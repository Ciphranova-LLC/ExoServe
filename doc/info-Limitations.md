# ExoServe Limitations

While the server has no knowledge at rest of file contents, file names, or directory topology, metadata could be ascertained while the data is in transit by monitoring live network traffic.

This is a standard convenience-versus-security tradeoff. The alternative is to:

- Have the client wholly download all files to mitigate streaming metadata leakage.
- Chunk files on the server to mitigate file size metadata leakage.
- Generate dummy traffic to obfuscate sequentially requested chunks being related.
- Throttle requests to a constant bitrate to mitigate rapidly requested chunks being related

This design is not currently on the roadmap, as the experience would be sluggish.