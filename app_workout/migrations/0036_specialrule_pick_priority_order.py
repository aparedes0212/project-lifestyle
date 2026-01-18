from django.db import migrations, models
import app_workout.models


class Migration(migrations.Migration):

    dependencies = [
        ("app_workout", "0035_remove_supplementalworkoutdescription_workout_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="specialrule",
            name="pick_priority_order",
            field=models.JSONField(default=app_workout.models.default_pick_priority_order),
        ),
    ]
