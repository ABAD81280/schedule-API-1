const express = require('express');
const app = express();
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-key.json');
const cors = require("cors");

// Enable CORS for the frontend origin
app.use(cors({ origin: "https://schedule-6ec19.firebaseapp.com" }));

// Initialize Firebase Admin SDK
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://schedule-6ec19-default-rtdb.firebaseio.com/"
});

// Enable JSON parsing for incoming requests
app.use(express.json());

const db = admin.database();

// Endpoint to clear schedules and sections
app.post('/clear-schedules', async (req, res) => {
    try {
        await db.ref('sections').remove();
        await db.ref('schedules').remove();
        res.json({ success: true, message: "All schedules and sections cleared successfully" });
    } catch (error) {
        console.error("Error clearing schedules and sections:", error);
        res.status(500).json({ success: false, message: "Failed to clear schedules and sections" });
    }
});

// Add a student to the database
async function addStudent(student) {
    if (!student.id || !student.name || !student.academicNumber || !student.subjects) {
        return { success: false, message: "Missing required fields: id, name, academicNumber, subjects" };
    }

    const studentRef = db.ref('students/' + student.id);
    const snapshot = await studentRef.once('value');

    if (snapshot.exists()) {
        return { success: false, message: "Student with this ID already exists" };
    }

    await studentRef.set(student);
    return { success: true, message: "Student added successfully", student };
}

// Add a teacher to the database
async function addTeacher(teacher) {
    if (!teacher.id || !teacher.name || !teacher.academicNumber || !teacher.subjects) {
        return { success: false, message: "Missing required fields: id, name, academicNumber, subjects" };
    }

    const teacherRef = db.ref('teachers/' + teacher.id);
    const snapshot = await teacherRef.once('value');

    if (snapshot.exists()) {
        return { success: false, message: "Teacher with this ID already exists" };
    }

    await teacherRef.set(teacher);
    return { success: true, message: "Teacher added successfully", teacher };
}

// Add a subject to the database
async function addSubject(subject) {
    if (!subject.id || !subject.name || !subject.time) {
        return { success: false, message: "Missing required fields: id, name, time" };
    }

    const subjectRef = db.ref('subjects/' + subject.id);
    const snapshot = await subjectRef.once('value');

    if (snapshot.exists()) {
        return { success: false, message: "Subject with this ID already exists" };
    }

    await subjectRef.set(subject);
    return { success: true, message: "Subject added successfully", subject };
}

// Add a classroom to the database
async function addClassroom(classroom) {
    if (!classroom.id || !classroom.name || !classroom.capacity) {
        return { success: false, message: "Missing required fields: id, name, capacity" };
    }

    const classroomRef = db.ref('classrooms/' + classroom.id);
    const snapshot = await classroomRef.once('value');

    if (snapshot.exists()) {
        return { success: false, message: "Classroom with this ID already exists" };
    }

    await classroomRef.set(classroom);
    return { success: true, message: "Classroom added successfully", classroom };
}

// Generate time slots for scheduling
const timeSlots = [];
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];
const hours = ['8:00-9:00', '9:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-1:00', '1:00-2:00', '2:00-3:00', '3:00-4:00'];

days.forEach(day => {
    hours.forEach(hour => {
        timeSlots.push(`${day} ${hour}`);
    });
});

// Fetch students from the database
async function getStudents() {
    const snapshot = await db.ref('students').once('value');
    const students = [];
    snapshot.forEach(childSnapshot => {
        students.push(childSnapshot.val());
    });
    return students;
}

// Fetch teachers from the database
async function getTeachers() {
    const snapshot = await db.ref('teachers').once('value');
    const teachers = [];
    snapshot.forEach(childSnapshot => {
        teachers.push(childSnapshot.val());
    });
    return teachers;
}

// Fetch subjects from the database
async function getSubjects() {
    const snapshot = await db.ref('subjects').once('value');
    const subjects = [];
    snapshot.forEach(childSnapshot => {
        subjects.push(childSnapshot.val());
    });
    return subjects;
}

// Fetch classrooms from the database
async function getClassrooms() {
    const snapshot = await db.ref('classrooms').once('value');
    const classrooms = [];
    snapshot.forEach(childSnapshot => {
        classrooms.push(childSnapshot.val());
    });
    return classrooms;
}

// Find available section for a subject
async function findAvailableSection(subject) {
    const classrooms = await getClassrooms();
    const sectionsData = await db.ref('sections').once('value');
    const sectionsList = [];
    sectionsData.forEach(child => {
        sectionsList.push(child.val());
    });

    const subjectSections = sectionsList.filter(sec => sec.subjectId === subject.id);

    for (let sec of subjectSections) {
        const classroom = classrooms.find(c => c.id === sec.classroomId);
        if (!classroom) continue;

        const availableSeats = classroom.capacity - sec.studentCount;
        if (availableSeats > 0) {
            return sec;
        }
    }

    return null;
}

// Find the best teacher and classroom combination for scheduling
function selectTeacherClassroomCombination(teachers, classrooms, numberOfSlotsNeeded) {
    if (!teachers || teachers.length === 0) {
        console.warn("No teachers available for scheduling.");
        return null;
    }

    if (!classrooms || classrooms.length === 0) {
        console.warn("No classrooms available for scheduling.");
        return null;
    }

    for (let teacher of teachers) {
        if (!teacher.availableTimeSlots || teacher.availableTimeSlots.length === 0) {
            console.warn(`Teacher ${teacher.teacher?.name || "Unknown"} has no available time slots.`);
            continue;
        }

        for (let classroom of classrooms) {
            if (!classroom.availableTimeSlots || classroom.availableTimeSlots.length === 0) {
                console.warn(`Classroom ${classroom.classroom?.name || "Unknown"} has no available time slots.`);
                continue;
            }

            const matchingSlots = teacher.availableTimeSlots.filter(slot =>
                classroom.availableTimeSlots.includes(slot)
            );

            if (matchingSlots.length >= numberOfSlotsNeeded) {
                const selectedTimeSlots = matchingSlots.slice(0, numberOfSlotsNeeded);

                return {
                    teacher: teacher.teacher,
                    classroom: classroom.classroom,
                    timeSlots: selectedTimeSlots,
                };
            }
        }
    }

    console.warn("No matching teacher/classroom/time combination found.");
    return null;
}


// Get teacher availability for a subject
async function getTeachersAvailability(subject) {
    const teachers = await getTeachers();

    const teachersAvailability = await Promise.all(teachers.map(async teacher => {
        if (!teacher.subjects.includes(subject.id)) return null;

        const unavailableTimeSlots = [];
        const sectionsData = await db.ref('sections').once('value');
        sectionsData.forEach(child => {
            const section = child.val();
            if (section.teacherId === teacher.id) {
                unavailableTimeSlots.push(...section.timeSlots);
            }
        });

        const availableTimeSlots = timeSlots.filter(slot => !unavailableTimeSlots.includes(slot));
        return { teacher, availableTimeSlots };
    }));

    return teachersAvailability.filter(Boolean);
}

// Get classroom availability
async function getClassroomsAvailability() {
    const classrooms = await getClassrooms();

    const classroomsAvailability = await Promise.all(classrooms.map(async (classroom) => {
        const unavailableTimeSlots = [];
        const sectionsData = await db.ref('sections').once('value');
        sectionsData.forEach(child => {
            const section = child.val();
            if (section.classroomId === classroom.id) {
                unavailableTimeSlots.push(...section.timeSlots);
            }
        });

        const availableTimeSlots = timeSlots.filter(slot => !unavailableTimeSlots.includes(slot));
        if (availableTimeSlots.length === 0) {
            console.warn(`Classroom ${classroom.name || 'Unknown'} (${classroom.id}) has no available time slots.`);
        }

        return { classroom, availableTimeSlots };
    }));

    return classroomsAvailability.filter(({ availableTimeSlots }) => availableTimeSlots.length > 0);
}


// Create a new section for a subject
async function createNewSection(subject) {
    const teachersAvailability = await getTeachersAvailability(subject);
    const classroomsAvailability = await getClassroomsAvailability();

    if (teachersAvailability.length === 0 || classroomsAvailability.length === 0) {
        return null;
    }

    const teacherClassroomCombination = selectTeacherClassroomCombination(
        teachersAvailability,
        classroomsAvailability,
        subject.time
    );

    if (!teacherClassroomCombination) {
        return null;
    }

    const newSection = {
        id: Date.now(),
        subjectId: subject.id,
        teacherId: teacherClassroomCombination.teacher.id,
        classroomId: teacherClassroomCombination.classroom.id,
        timeSlots: teacherClassroomCombination.timeSlots,
        studentCount: 0,
    };

    await db.ref(`sections/${newSection.id}`).set(newSection);
    return newSection;
}

// Create schedules for all students and subjects
app.post('/create-schedules', async (req, res) => {
    try {
        const students = await getStudents();
        const subjects = await getSubjects();

        const schedules = {};

        for (let student of students) {
            for (let subjectId of student.subjects) {
                const subject = subjects.find(sub => sub.id === subjectId);

                if (!subject) {
                    console.warn(`Subject with ID ${subjectId} not found.`);
                    continue;
                }

                let section = await findAvailableSection(subject);

                if (!section) {
                    section = await createNewSection(subject);
                }

                if (!section) {
                    console.warn(`Failed to create or find a section for subject ${subject.name}.`);
                    continue;
                }

                const teacher = await db.ref(`teachers/${section.teacherId}`).once('value');
                const classroom = await db.ref(`classrooms/${section.classroomId}`).once('value');

                schedules[`${student.id}-${subject.id}`] = {
                    student,
                    subject,
                    teacher: teacher.val(),
                    classroom: classroom.val(),
                    section,
                };

                // Update student count in the section
                await db.ref(`sections/${section.id}/studentCount`).set(section.studentCount + 1);
            }
        }

        res.json({
            message: 'Schedules created successfully',
            schedules,
        });
    } catch (error) {
        console.error('Error creating schedules:', error);
        res.status(500).json({ error: 'An error occurred while creating schedules.' });
    }
});



app.get('/get-subjects', async (req, res) => {
    try {
        const snapshot = await db.ref('subjects').once('value');
        const subjects = [];
        snapshot.forEach(childSnapshot => {
            subjects.push({ id: childSnapshot.key, ...childSnapshot.val() });
        });
        res.json({ success: true, subjects });
    } catch (error) {
        console.error("Error fetching subjects:", error);
        res.status(500).json({ success: false, message: "Failed to fetch subjects" });
    }
});

app.post('/add-student', async (req, res) => {
    const result = await addStudent(req.body);
    res.status(result.success ? 200 : 400).json(result);
});

app.post('/add-teacher', async (req, res) => {
    const result = await addTeacher(req.body);
    res.status(result.success ? 200 : 400).json(result);
});

app.post('/add-subject', async (req, res) => {
    const result = await addSubject(req.body);
    res.status(result.success ? 200 : 400).json(result);
});

app.post('/add-classroom', async (req, res) => {
    const result = await addClassroom(req.body);
    res.status(result.success ? 200 : 400).json(result);
});
app.get('/get-students', async (req, res) => {
    try {
        const snapshot = await db.ref('students').once('value');
        const students = [];
        snapshot.forEach(childSnapshot => {
            students.push({ id: childSnapshot.key, ...childSnapshot.val() });
        });
        res.json({ success: true, students });
    } catch (error) {
        console.error("Error fetching students:", error);
        res.status(500).json({ success: false, message: "Failed to fetch students" });
    }
});

app.put('/update-student/:id', async (req, res) => {
    try {
        const studentId = req.params.id;
        const updatedData = req.body;

        const studentRef = db.ref(`students/${studentId}`);
        const snapshot = await studentRef.once('value');

        if (!snapshot.exists()) {
            return res.status(404).json({ success: false, message: "Student not found" });
        }

        await studentRef.update(updatedData);
        res.json({ success: true, message: "Student updated successfully" });
    } catch (error) {
        console.error("Error updating student:", error);
        res.status(500).json({ success: false, message: "Failed to update student" });
    }
});

app.delete('/delete-student/:id', async (req, res) => {
    try {
        const studentId = req.params.id;

        const studentRef = db.ref(`students/${studentId}`);
        const snapshot = await studentRef.once('value');

        if (!snapshot.exists()) {
            return res.status(404).json({ success: false, message: "Student not found" });
        }

        await studentRef.remove();
        res.json({ success: true, message: "Student deleted successfully" });
    } catch (error) {
        console.error("Error deleting student:", error);
        res.status(500).json({ success: false, message: "Failed to delete student" });
    }
});

// تحديث معلومات المعلم
app.put('/update-teacher/:id', async (req, res) => {
    const teacherId = req.params.id;
    const { name, academicNumber, subjects } = req.body;

    if (!name || !academicNumber || !subjects) {
        return res.status(400).json({ success: false, message: "Missing required fields: name, academicNumber, subjects" });
    }

    try {
        const teacherRef = db.ref(`teachers/${teacherId}`);
        const snapshot = await teacherRef.once('value');

        if (!snapshot.exists()) {
            return res.status(404).json({ success: false, message: "Teacher not found" });
        }

        await teacherRef.update({ name, academicNumber, subjects });
        res.json({ success: true, message: "Teacher updated successfully" });
    } catch (error) {
        console.error("Error updating teacher:", error);
        res.status(500).json({ success: false, message: "An error occurred while updating the teacher." });
    }
});

// حذف معلم
app.delete('/delete-teacher/:id', async (req, res) => {
    const teacherId = req.params.id;

    try {
        const teacherRef = db.ref(`teachers/${teacherId}`);
        const snapshot = await teacherRef.once('value');

        if (!snapshot.exists()) {
            return res.status(404).json({ success: false, message: "Teacher not found" });
        }

        await teacherRef.remove();
        res.json({ success: true, message: "Teacher deleted successfully" });
    } catch (error) {
        console.error("Error deleting teacher:", error);
        res.status(500).json({ success: false, message: "An error occurred while deleting the teacher." });
    }
});

// جلب قائمة المعلمين
app.get('/get-teachers', async (req, res) => {
    try {
        const snapshot = await db.ref('teachers').once('value');
        const teachers = [];

        snapshot.forEach((childSnapshot) => {
            teachers.push({ id: childSnapshot.key, ...childSnapshot.val() });
        });

        res.json({ success: true, teachers });
    } catch (error) {
        console.error("Error fetching teachers:", error);
        res.status(500).json({ success: false, message: "Failed to fetch teachers." });
    }
});

app.put('/update-subject/:id', async (req, res) => {
    const { id } = req.params;
    const { name, time } = req.body;

    if (!name || !time) {
        return res.status(400).json({ success: false, message: 'Missing required fields: name, time.' });
    }

    try {
        const subjectRef = db.ref(`subjects/${id}`);
        const snapshot = await subjectRef.once('value');
        if (!snapshot.exists()) {
            return res.status(404).json({ success: false, message: 'Subject not found.' });
        }

        await subjectRef.update({ name, time });
        res.json({ success: true, message: 'Subject updated successfully.' });
    } catch (error) {
        console.error('Error updating subject:', error);
        res.status(500).json({ success: false, message: 'Failed to update subject.' });
    }
});

app.delete('/delete-subject/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const subjectRef = db.ref(`subjects/${id}`);
        const snapshot = await subjectRef.once('value');
        if (!snapshot.exists()) {
            return res.status(404).json({ success: false, message: 'Subject not found.' });
        }

        await subjectRef.remove();
        res.json({ success: true, message: 'Subject deleted successfully.' });
    } catch (error) {
        console.error('Error deleting subject:', error);
        res.status(500).json({ success: false, message: 'Failed to delete subject.' });
    }
});

// Endpoint للحصول على جميع الفصول
app.get('/get-classrooms', async (req, res) => {
    try {
        const snapshot = await db.ref('classrooms').once('value');
        const classrooms = [];
        snapshot.forEach(childSnapshot => {
            classrooms.push({ id: childSnapshot.key, ...childSnapshot.val() });
        });
        res.json({ success: true, classrooms });
    } catch (error) {
        console.error("Error fetching classrooms:", error);
        res.status(500).json({ success: false, message: "Failed to fetch classrooms" });
    }
});

// Endpoint لتحديث بيانات الفصل
app.put('/update-classroom/:id', async (req, res) => {
    const classroomId = req.params.id;
    const updatedData = req.body;

    try {
        const classroomRef = db.ref(`classrooms/${classroomId}`);
        const snapshot = await classroomRef.once('value');

        if (!snapshot.exists()) {
            return res.status(404).json({ success: false, message: "Classroom not found" });
        }

        await classroomRef.update(updatedData);
        res.json({ success: true, message: "Classroom updated successfully" });
    } catch (error) {
        console.error("Error updating classroom:", error);
        res.status(500).json({ success: false, message: "Failed to update classroom" });
    }
});

// Endpoint لحذف فصل
app.delete('/delete-classroom/:id', async (req, res) => {
    const classroomId = req.params.id;

    try {
        const classroomRef = db.ref(`classrooms/${classroomId}`);
        const snapshot = await classroomRef.once('value');

        if (!snapshot.exists()) {
            return res.status(404).json({ success: false, message: "Classroom not found" });
        }

        await classroomRef.remove();
        res.json({ success: true, message: "Classroom deleted successfully" });
    } catch (error) {
        console.error("Error deleting classroom:", error);
        res.status(500).json({ success: false, message: "Failed to delete classroom" });
    }
});

// Start the server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

app.get('/', (req, res) => {
    res.send('Hello World!33');
});
