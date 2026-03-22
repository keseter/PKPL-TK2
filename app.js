const express = require("express");
const path = require("path");
const members = require("./data/members");

const app = express();
const PORT = 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.render("index", {
    groupName: "Kelompok 01",
    courseName: "Project 2: Authentication & Authorization",
    members: members,

    // placeholder supaya nanti mudah dihubungkan ke OAuth
    isLoggedIn: false,
    user: null,

    // placeholder theme supaya nanti mudah diubah oleh anggota yang login
    theme: {
      bgColor: "#f5f7fb",
      textColor: "#1f2937",
      cardColor: "#ffffff",
      fontFamily: "Arial, sans-serif"
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});