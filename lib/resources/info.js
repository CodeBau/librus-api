"use strict";
const _ = require("lodash");
const Resource = require("../tools.js").Resource,
  Librus = require("../api.js");

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function emptySemester() {
  return { grades: [], tempAverage: null, average: null };
}

function parseNumberOrNull(value) {
  const parsed = Number(normalizeText(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractLinkedGradeId($, cell) {
  const link = $(cell).find("a").first();
  const sources = [link.attr("onclick") || "", link.attr("href") || ""];

  for (const source of sources) {
    const match =
      source.match(/\/komentarz_oceny\/\d+\/(\d+)/) ||
      source.match(/\/przegladaj_oceny(?:_punktowe)?\/zachowanie_szczegoly\/(\d+)/) ||
      source.match(/\/przegladaj_oceny(?:_punktowe)?\/szczegoly\/(\d+)/);

    if (match) return parseInt(match[1], 10);

    const tail = source.split("/").filter(Boolean).pop();
    if (/^\d+$/.test(tail)) return parseInt(tail, 10);
  }

  return null;
}

function parseBehaviorSubject($, row) {
  const subject = {
    name: "Zachowanie",
    semester: [emptySemester(), emptySemester(), emptySemester(), emptySemester()],
    tempAverage: null,
    average: null,
  };

  const detailTable = $("#przedmioty_zachowanie table.stretch");
  const semesters = [subject.semester[0], subject.semester[2]];
  const rowCells = row ? $(row).children("td") : [];

  const firstSemesterStart = parseNumberOrNull($(rowCells[2]).text());
  const secondSemesterStart = parseNumberOrNull($(rowCells[4]).text());

  if (firstSemesterStart !== null) {
    subject.semester[0].tempAverage = firstSemesterStart;
  }

  if (secondSemesterStart !== null) {
    subject.semester[2].tempAverage = secondSemesterStart;
  }

  if (!detailTable.length) {
    return subject;
  }

  let currentPeriod = 0;

  detailTable.find("tbody > tr").each((_, detailRow) => {
    const $detailRow = $(detailRow);

    if ($detailRow.hasClass("bolded")) {
      const label = normalizeText($detailRow.text());
      const match = label.match(/Okres\s+(\d+)/i);
      currentPeriod = match ? Math.max(0, Number(match[1]) - 1) : currentPeriod;
      return;
    }

    const cells = $detailRow.children("td");
    if (!cells.length) return;

    const label = normalizeText($(cells[0]).text());
    if (!label || /^Brak ocen$/i.test(label)) return;

    if (/^Punkty startowe$/i.test(label)) {
      if (semesters[currentPeriod]) {
        semesters[currentPeriod].tempAverage = parseNumberOrNull($(cells[2]).text());
      }
      return;
    }

    if (/^Suma$/i.test(label)) {
      if (semesters[currentPeriod]) {
        semesters[currentPeriod].average = parseNumberOrNull($(cells[2]).text());
      }
      return;
    }

    const link = $(cells[1]).find("a").first();
    const title = (link.attr("title") || "").replace(/<\s*br\s*\/?\s*>/g, "\n");
    const info =
      title ||
      [
        `Kategoria: ${label}`,
        `Data: ${normalizeText($(cells[3]).text())}`,
        `Nauczyciel: ${normalizeText($(cells[4]).text())}`,
      ].join("\n");

    if (semesters[currentPeriod]) {
      semesters[currentPeriod].grades.push({
        id: extractLinkedGradeId($, cells[1]),
        info,
        value: normalizeText($(cells[2]).text()),
      });
    }
  });

  return subject;
}

module.exports = class Info extends Resource {
  /**
   * Get notifications
   * https://synergia.librus.pl/uczen_index
   *
   * @returns {Promise}
   */
  getNotifications() {
    return this.api
      ._mapper("uczen_index", "#graphic-menu ul li", ($, element) => {
        return $(element).text().replace(/\D+/g, "").trim().length
          ? $(element).text().replace(/\D+/g, "").trim()
          : "0";
      })
      .then((array) => {
        return _.zipObject(
          [
            "grades",
            "absence",
            "inbox",
            "announcements",
            "calendar",
            "homework",
          ],
          array.slice(1).map((e) => Number(e))
        );
      });
  }
  getAccountInfo() {
    let parser = ($, element) => {
      return {
        student: {
          nameSurname: $(
            "#body > div > div > table > tbody > tr:nth-child(1) > td"
          ).text(),
          class: $("#body > div > div > table > tbody > tr:nth-child(2) > td")
            .text()
            .trim(),
          index: $("#body > div > div > table > tbody > tr:nth-child(3) > td")
            .text()
            .trim(),
          educator: $(
            "#body > div > div > table > tbody > tr:nth-child(4) > td"
          )
            .text()
            .trim(),
        },
        account: {
          nameSurname: $(
            "#body > div > div > table > tbody > tr:nth-child(7) > td"
          )
            .text()
            .trim(),
          login: $("#body > div > div > table > tbody > tr:nth-child(8) > td")
            .text()
            .trim(),
        },
      };
    };
    return this.api._singleMapper("informacja", "html", parser);
  }

  /**
   * Get grade info
   * https://synergia.librus.pl/przegladaj_oceny/szczegoly
   *
   * @param gradeId Grade ID
   * @returns {Promise}
   */
  getGrade(gradeId) {
    let parser = ($, table) => {
      let keys = [
        "grade",
        "category",
        "date",
        "teacher",
        "lesson",
        "inAverage",
        "multiplier",
        "user",
        "comment",
      ];

      switch ($(table).find("th").length) {
        /** e.g. - */
        case 7:
          _.pullAt(keys, 5, 6);
          break;

        /** with multiplier 0 */
        case 8:
          _.pullAt(keys, 6);
          break;
      }

      let values = Librus.mapTableValues($(table), keys);
      return "inAverage" in values
        ? _.assign(values, {
            inAverage:
              $(table).find("img").attr("src") === "/images/aktywne.png",
          })
        : values;
    };
    return this.api._singleMapper(
      `przegladaj_oceny/szczegoly/${gradeId}`,
      ".container-background table.decorated.medium.center tbody",
      parser
    );
  }
  /**
   * Get Point grade info
   * https://synergia.librus.pl/przegladaj_oceny_punktowe/szczegoly
   *
   * @param gradeId Grade ID
   * @returns {Promise}
   */
  getPointGrade(gradeId) {
    let parser = ($, table) => {
      let keys = [
        "grade",
        "category",
        "date",
        "teacher",
        "lesson",
        "inAverage",
        "multiplier",
        "user",
        "comment",
      ];

      switch ($(table).find("th").length) {
        /** e.g. - */
        case 7:
          _.pullAt(keys, 5, 6);
          break;

        /** with multiplier 0 */
        case 8:
          _.pullAt(keys, 6);
          break;
      }

      let values = Librus.mapTableValues($(table), keys);
      return "inAverage" in values
        ? _.assign(values, {
            inAverage:
              $(table).find("img").attr("src") === "/images/aktywne.png",
          })
        : values;
    };
    return this.api._singleMapper(
      `przegladaj_oceny_punktowe/szczegoly/${gradeId}`,
      ".container-background table.decorated.medium.center",
      parser
    );
  }
  /**
   * Get lucky number
   * https://synergia.librus.pl/uczen/index
   *
   * @returns {Promise}
   */
  getLuckyNumber() {
    let parser = ($, element) => {
      const text = $(element).text().replace(/[^\d]/g, "");
      return text ? parseInt(text, 10) : null;
    };
    return this.api._singleMapper("uczen_index", ".luckyNumber", parser);
  }
  /**
   * Get grades list
   * https://synergia.librus.pl/przegladaj_oceny/uczen
   *
   * @returns {Promise}
   */
  getGrades() {
    let parser = ($, row) => {
      let children = $(row).children("td");
      const name = normalizeText($(children[1]).text());

      if (/^Zachowanie$/i.test(name)) {
        return parseBehaviorSubject($, row);
      }

      /**
       * Get average from column text
       * @param colIndex  Column index
       * @returns {Number}
       */
      let average = (colIndex) => {
        return parseFloat($(children[colIndex]).text());
      };

      /**
       * Parse semester, get average and grades
       * @param startColumn
       */
      let semester = (startColumn) => {
        let grades = _.map(
          $(children[startColumn]).find("span.grade-box"),
          (element) => {
            const link = $(element).find("a").first();
            const href = link.attr("href") || "";
            const idRaw = href.split("/")[href.split("/").length - 1];
            const title = (link.attr("title") || "").replace(
              /<\s*br\s*\/?\s*>/g,
              "\n"
            );
            const value = link.text().trim().replace(/\*+$/, "").trim();

            return {
              id: parseInt(idRaw),
              info: title,
              value: value,
            };
          }
        );
        return {
          grades: grades,
          tempAverage: average(startColumn + 1),
          average: average(startColumn + 2),
        };
      };

      if (name)
        return {
          name,
          semester: [semester(2), semester(5), semester(6), semester(9)],
          tempAverage: average(8),
          average: average(9),
        };
    };
    return this.api._mapper(
      "przegladaj_oceny/uczen",
      "table.decorated.stretch:eq(1) > tbody > tr[class^='line']:not([name]),table.decorated.stretch:eq(1) > tbody > tr.bolded.line1:not([name]),table.decorated.stretch:eq(1) > tr[class^='line']:not([name]),table.decorated.stretch:eq(1) > tr.bolded.line1:not([name])",
      parser
    );
  }
};
