from django.db import migrations, models
from django.db.models import F


def copy_max_reps_to_goal(apps, schema_editor):
    StrengthDailyLog = apps.get_model("app_workout", "StrengthDailyLog")
    StrengthDailyLog.objects.filter(max_reps__isnull=False).update(max_reps_goal=F("max_reps"))


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("app_workout", "0020_remove_strengthcurrentmaxdailyvolume_routine_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="strengthdailylog",
            name="max_reps_goal",
            field=models.FloatField(null=True, blank=True),
        ),
        migrations.RunPython(copy_max_reps_to_goal, reverse_code=noop),
    ]
